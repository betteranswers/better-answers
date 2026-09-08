import {
  boundarySchemas,
  NIGHTLY_AUDIT_KIND,
  type FULL_REBUILD_KIND,
  type JOB_KINDS,
  type REBUILD_REASONS,
} from "@better-answers/schema";

import {
  attempt,
  err,
  ok,
  requireAdmin,
  ulid,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { withMembership, type PostgresDoor } from "../store/postgres/index.ts";

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
 * A job is **not an audit event and never becomes one**: runs are their own
 * record. Enqueueing, claiming and finishing write no ledger row, and this slice calls no
 * audit door.
 *
 * ADR 0029 rule 3 — imports `kernel` and `store`; never another slice.
 */

export type JobKind = (typeof JOB_KINDS)[number];
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
 * Put a job on this workspace's queue, and answer the id it was given.
 *
 * **Admin's, and by the same reasoning as every other act over the whole workspace**: a
 * rebuild throws the derived map away and makes it again, and an audit is the platform
 * checking itself; neither is a thing an Editor does in the course of writing a concept.
 * The role is re-checked inside the transaction (`withMembership`), so a role that moved
 * between the request boundary and the write refuses here.
 *
 * The id is minted before the insert, as every id the platform writes for itself is
 * (ADR 0035), and answered so a caller can wait for the job it queued rather than for the
 * next one to appear.
 */
export const enqueueJob = async (
  principal: UserPrincipal,
  door: PostgresDoor,
  job: EnqueuedJob,
): Promise<Result<string, RoleRefusal | PrincipalRefusal | Error>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);

  const id = ulid();
  const parsed = boundarySchemas.job.insert
    .pick({ workspaceId: true, id: true, kind: true, reason: true })
    .safeParse({
      workspaceId: principal.workspaceId,
      id,
      kind: job.kind,
      reason: "reason" in job ? job.reason : null,
    });
  // The boundary parses before the statement, so a kind or a reason the row would refuse
  // is refused where the caller can be told rather than by an aborted transaction.
  if (!parsed.success) return err(new Error("the job was not a job this queue carries"));

  const written = await attempt(() =>
    withMembership(principal, door, async (fresh, tx) => {
      await tx.query("INSERT INTO job (workspace_id, id, kind, reason) VALUES ($1, $2, $3, $4)", [
        fresh.workspaceId,
        parsed.data.id,
        parsed.data.kind,
        parsed.data.reason,
      ]);
      return parsed.data.id;
    }),
  );
  if (!written.ok) return err(written.error);
  if (!written.value.ok) return err(written.value.error);
  return ok(written.value.value);
};

type OutcomeRow = {
  readonly outcome: { readonly mismatched?: readonly unknown[] } | null;
};

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

  const outcome = read.value.value.rows[0]?.outcome;
  if (outcome === undefined) return ok("never-audited");
  // An outcome the worker wrote always carries the list; one that somehow does not is read
  // as a mismatch rather than as health, because the fail-closed reading of "I cannot tell"
  // is the one that puts a person in front of the bundle.
  return ok(outcome === null || (outcome.mismatched?.length ?? 1) > 0 ? "mismatched" : "healthy");
};
