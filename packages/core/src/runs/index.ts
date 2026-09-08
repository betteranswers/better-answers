import {
  boundarySchemas,
  FULL_REBUILD_KIND,
  NIGHTLY_AUDIT_KIND,
  type JOB_KINDS,
  type JOB_STATUSES,
  type REBUILD_REASONS,
} from "@better-answers/schema";
import type { z } from "zod";

import {
  attempt,
  err,
  ok,
  requireAdmin,
  ulid,
  type Principal,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { withMembership, withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";

/**
 * Slice: **runs** — the worker control plane as the app sees it.
 *
 * The plane is **rows and never HTTP** (ADR 0005), so this slice is one table's worth of
 * app-side calls: put a job on the queue, and read what the last one found. The claim
 * protocol itself — claim, lease, heartbeat, the two finishes — is SQL functions both tiers
 * call (`0022_the-queue-substrate.sql`, fixtured as the queue agreement in `contracts/`),
 * which is why there is no claiming here: a transition two clients each implemented would
 * be two readings of one rule.
 *
 * A job is **not an audit event and never becomes one**: runs are their own record, as the
 * audit slice's own vocabulary says, and its declared-acts walk refuses an act whose subject
 * names one. Enqueueing, claiming and finishing write no ledger row, and this slice calls no
 * audit door. What a job did is read off the job.
 *
 * **Both principals reach this queue, and they are not the same road.** A person's enqueue is
 * an Admin's act in their own workspace, re-checked inside the transaction. The platform's
 * runs for no person at all — the ops commands are cron's, inside a container, with no
 * session to resolve — so it names the workspace as an argument and is scoped to it, which is
 * the shape the Postgres door already has for a platform act.
 *
 * ADR 0029 rule 3 — imports `kernel` and `store`; never another slice.
 */

export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type RebuildReason = (typeof REBUILD_REASONS)[number];

/**
 * What is put on the queue: the kind, and — for a rebuild — which of ADR 0023's six
 * reasons it is happening for. The two are one argument rather than two, because a rebuild
 * without a reason and an audit with one are both rows the database refuses, and the type
 * is where a caller should hear that first.
 */
export type EnqueuedJob =
  | { readonly kind: typeof NIGHTLY_AUDIT_KIND }
  | { readonly kind: typeof FULL_REBUILD_KIND; readonly reason: RebuildReason };

/** What the platform can say about a workspace's two parsers agreeing (ADR 0025). */
export type BundleHealth =
  /** The last audit read every file and found no hash it disagreed with. */
  | "healthy"
  /** The last audit found at least one file whose hash is not the row's. */
  | "mismatched"
  /** No audit has finished here yet — a new workspace, or a worker that has not run. */
  | "never-audited";

/**
 * What a caller puts on the queue: the workspace, the kind, and — for a rebuild — which of
 * ADR 0023's six reasons it is happening for.
 *
 * The workspace is **always named**, on both roads. A platform principal carries none
 * (`CONTEXT.md`), so it has to; and a user principal's is checked against it rather than
 * quietly preferred, because a call that named another tenant's workspace is a caller with
 * the wrong idea, and answering it with its own workspace's job would hide that.
 */
export type EnqueueJobInput = { readonly workspaceId: string } & EnqueuedJob;

/**
 * What an enqueue refuses in a word: a role that may not ask for one, and a job the queue
 * does not carry — a kind it does not know, a rebuild with no reason, an audit with one, or
 * a workspace that is not the caller's.
 */
export type EnqueueJobRefusal = RoleRefusal | "malformed";

/** The job as this slice answers for it, which is all a caller needs to wait on one. */
export type JobState = {
  readonly jobId: string;
  readonly kind: JobKind;
  readonly reason: RebuildReason | null;
  readonly status: JobStatus;
  /** How many times it has been claimed; a claim increments it before the work starts. */
  readonly attempts: number;
  /** What the job found — counts, ids and paths — and `null` until it has finished. */
  readonly outcome: JobOutcome | null;
};

/**
 * What a job's outcome holds: counts, and the ids and paths the counts were taken at. The
 * keys are open — the shape belongs to the job that wrote it, and B7 adds kinds — but the
 * values are exactly what the column's boundary admits, so a reader of one knows it can hold
 * no nested object and therefore no person's name and no concept's body.
 *
 * **The boundary's own shape, parsed on every read.** The finish functions take any JSONB
 * the claimant hands them — the queue agreement's functions are the database's and carry no
 * schema — so what holds the contract is that every outcome the app reads back goes through
 * the boundary first: one that grew a nested place to hide content in is an outcome this
 * slice will not serve, not a value it hands a caller under the documented type.
 */
const OUTCOME = boundarySchemas.job.select.shape.outcome;
export type JobOutcome = NonNullable<z.infer<typeof OUTCOME>>;
/** What the column hands the driver before the boundary has read it. */
type OutcomeColumn = z.input<typeof OUTCOME>;

/**
 * A row's outcome as the boundary reads it. A caller that asked for a job and got one whose
 * outcome the boundary refuses is handed the refusal as the store's own failure: the row is
 * the worker's, the shape is the agreement's, and a value outside it is a fact about the
 * queue that an operator has to look at rather than a job to report on.
 */
const outcomeOf = (raw: OutcomeColumn): Result<JobOutcome | null, Error> => {
  const parsed = OUTCOME.safeParse(raw);
  return parsed.success
    ? ok(parsed.data)
    : err(new Error("the job's outcome is not the shape the queue agreement admits"));
};

/** The three statuses a job never leaves — what a caller polling one is waiting for. */
export const JOB_IS_OVER: readonly JobStatus[] = ["done", "failed", "poisoned"];

/** The row the two reads project, before the boundary narrows it. */
type JobRow = {
  readonly id: string;
  readonly kind: JobKind;
  readonly reason: RebuildReason | null;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly outcome: OutcomeColumn;
};

/**
 * Run `work` in one transaction scoped to `workspaceId`, by the road the principal has.
 *
 * A **person's** goes through `withMembership`, which re-reads the membership under a shared
 * lock and refuses a role that moved since the request boundary — so an Admin demoted between
 * the call and the write does not get their job. A **platform** principal has no membership to
 * re-read and no person behind it, so it takes `withScope`, which is the door's own shape for
 * an act the platform makes as itself. The two are one function because everything after the
 * scope is set is identical, and two copies would be two places to set it late.
 */
const inWorkspace = async <T>(
  principal: Principal,
  door: PostgresDoor,
  workspaceId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<Result<T, PrincipalRefusal | Error>> => {
  if (principal.kind === "platform") {
    return attempt(() => withScope(principal, door, workspaceId, (tx) => work(tx)));
  }
  const held = await attempt(() => withMembership(principal, door, (_fresh, tx) => work(tx)));
  if (!held.ok) return err(held.error);
  if (!held.value.ok) return err(held.value.error);
  return ok(held.value.value);
};

/**
 * The person's gate on both roads of this slice: an Admin, acting in the workspace their
 * credential names. The platform passes — it has no role to check and no workspace of its own
 * to hold it to; the argument beside it is the workspace it acts in.
 *
 * The word for a foreign workspace is the caller's, because the two roads mean different
 * things by it: an enqueue that named another tenant is a `malformed` request, while a poll
 * for a job in one is a job this workspace never held.
 */
const adminInOwnWorkspace = <Elsewhere extends string>(
  principal: Principal,
  workspaceId: string,
  elsewhere: Elsewhere,
): Result<undefined, RoleRefusal | Elsewhere> => {
  if (principal.kind === "platform") return ok(undefined);
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  if (workspaceId !== principal.workspaceId) return err(elsewhere);
  return ok(undefined);
};

/**
 * Put a job on a workspace's queue, and answer the id it was given.
 *
 * **A person's enqueue is an Admin's**, by the same reasoning as every other act over the
 * whole workspace: a rebuild throws the derived map away and makes it again, and an audit is
 * the platform checking itself; neither is a thing an Editor does in the course of writing a
 * concept. The role is re-checked inside the transaction, so a role that moved between the
 * request boundary and the write refuses here.
 *
 * **The platform's has no role to check and no person to name.** `pnpm ops graph-rebuild` runs
 * from cron inside a container with no session to resolve, and work that outlives a session
 * runs under a platform principal, never a live one. So the platform road is the principal's
 * own type: nothing is invented, and the workspace it acts in is the argument beside it.
 *
 * The id is minted before the insert, as every id the platform writes for itself is
 * (ADR 0035), and answered so a caller can wait for the job it queued rather than for the next
 * one to appear.
 */
export const enqueueJob = async (
  principal: Principal,
  door: PostgresDoor,
  input: EnqueueJobInput,
): Promise<Result<{ readonly jobId: string }, EnqueueJobRefusal | PrincipalRefusal | Error>> => {
  // A person acts in the workspace their credential names, and nowhere else. Refused
  // rather than silently corrected: a caller that named another tenant is a caller with
  // the wrong idea, and handing it a job in its own workspace would bury that.
  const admitted = adminInOwnWorkspace(principal, input.workspaceId, "malformed");
  if (!admitted.ok) return err(admitted.error);

  // The pair the row's CHECK ties together, checked here too: a rebuild says why it is
  // happening and nothing else carries a reason. The type says so already, but a transport
  // parses a request into this input and a refusal is a word a caller can act on, where the
  // row's constraint is an aborted transaction somebody has to read the SQL to understand.
  const saysWhy = "reason" in input;
  if ((input.kind === FULL_REBUILD_KIND) !== saysWhy) {
    return err("malformed");
  }

  const jobId = ulid();
  const parsed = boundarySchemas.job.insert
    .pick({ workspaceId: true, id: true, kind: true, reason: true })
    .safeParse({
      workspaceId: input.workspaceId,
      id: jobId,
      kind: input.kind,
      reason: "reason" in input ? input.reason : null,
    });
  // The boundary parses before the statement, so a kind or a reason the row would refuse is
  // refused where the caller can be told rather than by an aborted transaction.
  if (!parsed.success) return err("malformed");

  const written = await inWorkspace(principal, door, input.workspaceId, async (tx) => {
    await tx.query("INSERT INTO job (workspace_id, id, kind, reason) VALUES ($1, $2, $3, $4)", [
      parsed.data.workspaceId,
      parsed.data.id,
      parsed.data.kind,
      parsed.data.reason,
    ]);
  });
  if (!written.ok) return err(written.error);
  return ok({ jobId });
};

/**
 * One job as it stands — what a caller waiting on the job it queued reads.
 *
 * The `--wait` on an ops command is a poll over this: a rebuild is claimed by whichever
 * worker is free, runs in that process, and reports by writing its own row, so there is
 * nothing for a caller to hold open and nothing to be notified through. It reads through the
 * slice for the ordinary reason a transport reads through one: `apps/api` writes no SQL of
 * its own against another module's table (ADR 0029).
 *
 * `no-such-job` rather than an empty answer, because a caller polling an id it was handed and
 * finding nothing has been given the wrong id or the wrong workspace, and a `null` would let
 * it poll that mistake until its timeout.
 *
 * **A person reading one is an Admin**, which is `bundleHealth`'s gate beside it and for the
 * same reason: an audit's `outcome` carries the paths of every file whose hash disagreed with
 * its row, and there is no other read in this slice through which a Viewer or an Editor sees
 * the shape of the bundle. Scope is not the gate here — the policy admits every member of the
 * workspace — so the role is checked beside the data access, in front of it. The platform road
 * has no role to check and is the one the ops command's `--wait` polls on.
 */
export const jobById = async (
  principal: Principal,
  door: PostgresDoor,
  input: { readonly workspaceId: string; readonly jobId: string },
): Promise<Result<JobState, "no-such-job" | RoleRefusal | PrincipalRefusal | Error>> => {
  const admitted = adminInOwnWorkspace(principal, input.workspaceId, "no-such-job");
  if (!admitted.ok) return err(admitted.error);
  const read = await inWorkspace(principal, door, input.workspaceId, (tx) =>
    tx.query<JobRow>(
      "SELECT id, kind, reason, status, attempts, outcome FROM job WHERE workspace_id = $1 AND id = $2",
      [input.workspaceId, input.jobId],
    ),
  );
  if (!read.ok) return err(read.error);

  const row = read.value.rows[0];
  if (row === undefined) return err("no-such-job");
  const outcome = outcomeOf(row.outcome);
  if (!outcome.ok) return err(outcome.error);
  return ok({
    jobId: row.id,
    kind: row.kind,
    reason: row.reason,
    status: row.status,
    attempts: row.attempts,
    outcome: outcome.value,
  });
};

type OutcomeRow = { readonly outcome: OutcomeColumn };

/**
 * The four lists a nightly audit's outcome carries, every one of which must be empty for a
 * bundle to be healthy: a file whose hash is not the row's, a file the grammar cannot read,
 * a file the index does not know, and a row whose file is gone (`ParseFindings` in
 * `apps/worker`). Each is the repository and the index disagreeing, and health that read
 * only the first would call a bundle healthy over a file nobody can parse.
 */
const AUDIT_FINDINGS = ["mismatched", "unparsed", "missing_row", "missing_file"] as const;

/**
 * **Bundle health**: whether the app's parse and the worker's still agree about this
 * workspace's bundle (ADR 0012, ADR 0023).
 *
 * A *signal* in ADR 0025's sense — a named query over rows the platform already keeps —
 * and deliberately nothing more: no metric, no scrape, and no table of its own. The rows
 * are the nightly audit's own outcomes, and what this reads is the **latest finished one**,
 * because health is a statement about now and a mismatch put right by an edit is not a
 * mismatch any more.
 *
 * Three answers and no fourth. *never-audited* is its own word rather than folded into
 * *healthy*, because "nobody has checked" and "somebody checked and found nothing wrong"
 * are different things to show a person — and the second is the only one that is good news.
 * *Healthy* is every finding list present and empty; anything else the outcome says — a
 * finding, a list missing, a value that is not a list, an outcome outside the boundary's
 * shape — is *mismatched*, because the fail-closed reading of "I cannot tell" is the one
 * that puts a person in front of the bundle.
 */
export const bundleHealth = async (
  principal: UserPrincipal,
  door: PostgresDoor,
): Promise<Result<BundleHealth, RoleRefusal | PrincipalRefusal | Error>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);

  const read = await attempt(() =>
    withMembership(principal, door, async (fresh, tx) =>
      tx.query<OutcomeRow>(
        `SELECT outcome FROM job
          WHERE workspace_id = $1 AND kind = $2 AND status = 'done'
          ORDER BY finished_at DESC LIMIT 1`,
        [fresh.workspaceId, NIGHTLY_AUDIT_KIND],
      ),
    ),
  );
  if (!read.ok) return err(read.error);
  if (!read.value.ok) return err(read.value.error);

  const row = read.value.value.rows[0];
  if (row === undefined) return ok("never-audited");
  const outcome = outcomeOf(row.outcome);
  if (!outcome.ok || outcome.value === null) return ok("mismatched");
  const findings = outcome.value;
  const clean = AUDIT_FINDINGS.every((finding) => {
    const found = findings[finding];
    return Array.isArray(found) && found.length === 0;
  });
  return ok(clean ? "healthy" : "mismatched");
};
