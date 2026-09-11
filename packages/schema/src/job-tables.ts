import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import type { ROLES } from "./roles.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The **queue** the worker claims from: one ordinary tenant table (`withRLS()`, ADR 0032),
 * owned by the `runs` slice — the worker control plane as the app sees it — and written by
 * both tiers, the app enqueueing and the worker claiming (ADR 0005: the control plane is
 * rows, never HTTP).
 *
 * The claim, the lease, the heartbeat and the two finishes are **SQL functions** in the
 * same journal (`0022_the-queue-substrate.sql`), so the transition is the database's rather
 * than two clients' agreeing interpretation of it (ADR 0031's sql-function form, fixtured
 * in `contracts/queue/`). This file declares only what a row *is*; what may be done to one
 * is written there.
 */

/** The nightly cross-check of the two parsers (ADR 0012, ADR 0023). */
export const NIGHTLY_AUDIT_KIND = "nightly-audit";

/** The whole-graph rebuild, which is the only thing a generation exists for (ADR 0023). */
export const FULL_REBUILD_KIND = "full-rebuild";

/**
 * A binding's documents through the seam and into the index — S1's one new kind. `reindex`
 * is not a kind of its own: it is this kind carrying a different reason, because what
 * re-runs is decided by the reason and a second kind would be a second host path for one
 * flow.
 */
export const INDEX_KIND = "index";

/**
 * The six reasons a full rebuild happens, exactly as ADR 0023 names them. A rebuild is
 * never routine — an ordinary edit's delta lands in the app's own commit transaction — so
 * every one of them is a thing that happened, and the row says which.
 */
export const REBUILD_REASONS = [
  "first-sync",
  "route-change",
  "reconciler",
  "erasure",
  "upgrade",
  "drill",
] as const;

/**
 * The five things that put a binding back through the index: the upload act binding it,
 * a finding an Admin kept in text, the binding's rules in force being edited, the erasure
 * routine wiping it, and a document narrowed from the review.
 */
export const INDEX_REASONS = ["bound", "restored", "rule-change", "wiped", "narrowed"] as const;

/**
 * Which tier's loop claims a kind. Every kind today is the worker's — the app enqueues a
 * rebuild from `pnpm ops` and waits for the worker to run it — and the word is on the
 * record because a later kind is the app's own: a question set's answer path runs where the
 * answering does (ADR 0005: the control plane is rows, so neither tier calls the other).
 */
export type ClaimingTier = "app" | "worker";

/**
 * What one **kind** of job is, declared in one place: the word on the row, the tier that
 * claims it, whether the row names the thing the job is about, the reasons it may carry,
 * and the role a person must hold to enqueue one.
 *
 * The kind, subject and reason CHECKs below are written *from this list*, so a kind is
 * added by adding a record and generating the migration — never by editing three CHECKs
 * by hand and finding out later that one of them was missed.
 */
export type JobKindDescriptor = {
  /** The word the row's `kind` column carries. */
  readonly kind: string;
  /** Whose loop claims it, and therefore which tier's registry must hold a handler. */
  readonly claimingTier: ClaimingTier;
  /** Whether the row names a subject — the binding an index job is for, and nothing else yet. */
  readonly namesASubject: boolean;
  /** The reasons this kind may carry; empty when it carries none. */
  readonly reasons: readonly string[];
  /** The role a person must hold for the enqueue to be theirs to make. */
  readonly enqueuedBy: (typeof ROLES)[number];
};

/**
 * One record per kind. The first two are the queue's own, T-006's obligations: the
 * **nightly parser audit**, where the Python parser cross-checks the app's parse
 * hash-by-hash, and the **full rebuild**, the graph sync run that writes a new generation
 * beside the live one and flips it (`CONTEXT.md`, *graph sync run*; ADR 0023). The third
 * is S1's: an **index** run over one binding, which is the only kind so far whose row says
 * what it is about.
 */
export const JOB_KIND_DESCRIPTORS = [
  {
    kind: NIGHTLY_AUDIT_KIND,
    claimingTier: "worker",
    namesASubject: false,
    reasons: [],
    enqueuedBy: "Admin",
  },
  {
    kind: FULL_REBUILD_KIND,
    claimingTier: "worker",
    namesASubject: false,
    reasons: REBUILD_REASONS,
    enqueuedBy: "Admin",
  },
  {
    kind: INDEX_KIND,
    claimingTier: "worker",
    namesASubject: true,
    reasons: INDEX_REASONS,
    enqueuedBy: "Admin",
  },
] as const satisfies readonly JobKindDescriptor[];

/** The kinds this queue carries, which is the descriptor list read down its first column. */
export const JOB_KINDS = JOB_KIND_DESCRIPTORS.map((descriptor) => descriptor.kind);

/**
 * Every reason any kind may carry. Which kind may carry which is the row's business — the
 * reason CHECK holds the *pair* — so this is the vocabulary and never the rule.
 */
export const JOB_REASONS = JOB_KIND_DESCRIPTORS.flatMap((descriptor) => [...descriptor.reasons]);

/** The kinds whose descriptor says the row names a subject. */
const KINDS_NAMING_A_SUBJECT = JOB_KIND_DESCRIPTORS.filter(
  (descriptor) => descriptor.namesASubject,
).map((descriptor) => descriptor.kind);

/** The kinds whose descriptor gives them reasons to choose from. */
const KINDS_CARRYING_A_REASON = JOB_KIND_DESCRIPTORS.filter(
  (descriptor) => descriptor.reasons.length > 0,
).map((descriptor) => descriptor.kind);

/** Every `(kind, reason)` the descriptors allow, as SQL row constructors. */
const KIND_REASON_PAIRS = JOB_KIND_DESCRIPTORS.flatMap((descriptor) =>
  descriptor.reasons.map((reason) => `('${descriptor.kind}', '${reason}')`),
).join(", ");

/**
 * What has become of a job. It is **queued** until a worker claims it; a *claimed* job holds
 * a *lease* (`CONTEXT.md`) it must keep confirming; it ends *done* or *failed* with an
 * outcome, or **poisoned** — claimed and lost as many times as it may be, so nothing claims
 * it again. Poisoning is the reaper's rule applied at claim time, which is what keeps an
 * expired lease from being lost and a poisoned job from being retried.
 */
export const JOB_STATUSES = ["queued", "claimed", "done", "failed", "poisoned"] as const;

/** What a job is born at: waiting for the worker that claims it. */
export const JOB_QUEUED_STATUS = "queued" satisfies (typeof JOB_STATUSES)[number];

/** Held by one worker under a lease it must keep confirming. */
export const JOB_CLAIMED_STATUS = "claimed" satisfies (typeof JOB_STATUSES)[number];

/**
 * The one finish that says the run did what it was queued for. It is its own word, apart from
 * the two sets below, because a gate on *this run succeeded* is a different question from a
 * gate on *this run is over*: a failed run is over and found nothing to act on.
 */
export const JOB_DONE_STATUS = "done" satisfies (typeof JOB_STATUSES)[number];

/** The statuses a job never leaves — the two finishes and the reaper's verdict. */
export const JOB_TERMINAL_STATUSES = ["done", "failed", "poisoned"] as const;

/** The two a run reaches by finishing, and the only two that carry an outcome. */
export const JOB_FINISHED_STATUSES = ["done", "failed"] as const;

/**
 * How many claims a job gets before it is poisoned. A claim increments the count, so three
 * is three attempts and not four; the number is here rather than in the function that
 * enforces it, because the column's default and the claim's rule are one fact.
 */
export const JOB_MAX_ATTEMPTS = 3;

/**
 * A **job** on the worker's queue: what to do, for which workspace, and every fact the
 * claim protocol needs to hand it to exactly one worker and take it back when that worker
 * stops answering.
 *
 * `outcome` is what the job **found** — counts, and the ids or paths it counted them at.
 * Never content, never an address and never a person's name: a job's outcome is a record
 * the platform keeps, and one that held any of those would have to be rewritten on erasure,
 * which is a thing the platform does to files and never to a record of what a run found.
 * **Its shape is the boundary's** (`outcome` in `boundary-schemas.ts`): one flat object
 * whose values are a scalar, a list of scalars, or a list of flat objects of scalars — the
 * auditor's `{path, expected, actual}` triple and nothing deeper. The worker writes exactly
 * that shape (`ParseFindings.as_row`, `RebuildOutcome.as_row` and the failure's `{error}` in
 * `apps/worker`), and the app parses every outcome it reads back through the boundary before
 * it answers a caller, so an outcome that grew a nested place to hide content in is refused
 * on the way out rather than served.
 *
 * A job is not an *audit event* and never becomes one: runs are their own record, as the
 * audit slice's own vocabulary says. There is no ledger row for enqueueing, claiming or
 * finishing one.
 */
export const job = withRLS(
  "job",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    /**
     * What the job is **about** — the binding an index run is for. Typed text rather than a
     * key or a payload field, because the thing a kind is about differs by kind and the
     * queue is not the place a binding's existence is enforced; NULL on every kind whose
     * descriptor names no subject.
     */
    subjectId: text("subject_id"),
    /** Why this job is happening; NULL on every kind whose descriptor gives it no reasons. */
    reason: text("reason"),
    status: text("status").notNull().default(JOB_QUEUED_STATUS),
    /** How many times this job has been claimed — incremented by the claim itself. */
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(JOB_MAX_ATTEMPTS),
    enqueuedAt: stamp("enqueued_at").notNull().defaultNow(),
    /** Which worker holds it: the worker id, which defaults to the container's hostname. */
    claimedBy: text("claimed_by"),
    claimedAt: stamp("claimed_at"),
    /** When the lease lapses, after which another claim may take the job (`CONTEXT.md`). */
    leaseExpiresAt: stamp("lease_expires_at"),
    /** The last time the claimant said it was alive; what the healthcheck reads. */
    heartbeatAt: stamp("heartbeat_at"),
    finishedAt: stamp("finished_at"),
    outcome: jsonb("outcome"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    // The claim's own read: the oldest claimable job in this workspace.
    index("job_workspace_id_status_enqueued_at_idx").on(
      table.workspaceId,
      table.status,
      table.enqueuedAt,
    ),
    // One queued job per subject, which is the *run key* the glossary names — held here
    // rather than as a column, so a second enqueue for a binding already waiting is the
    // database's refusal and the caller reads the first job's id back. A NULL subject is
    // distinct from a NULL subject in Postgres, so the two subjectless kinds queue as many
    // rows as they ever did.
    uniqueIndex("job_queued_subject_key")
      .on(table.workspaceId, table.kind, table.subjectId)
      .where(sql.raw(`status = '${JOB_QUEUED_STATUS}'`)),
    check("job_kind_check", sql.raw(`kind IN (${listed(JOB_KINDS)})`)),
    check("job_status_check", sql.raw(`status IN (${listed(JOB_STATUSES)})`)),
    // A biconditional, so it refuses both ways: an index job about nothing is a run with
    // nowhere to go, and a nightly audit about a binding is a row claiming a scope its
    // handler does not read.
    check(
      "job_subject_check",
      sql.raw(`(subject_id IS NOT NULL) = (kind IN (${listed(KINDS_NAMING_A_SUBJECT)}))`),
    ),
    // The rule is the *pair*, never the word: a rebuild's six names are what an operator
    // reads off a rebuild that happened, so a rebuild with no reason cannot say why the map
    // was thrown away — and an index reason on a rebuild would be a row whose two halves
    // describe different runs.
    check(
      "job_reason_check",
      sql.raw(
        `(reason IS NOT NULL) = (kind IN (${listed(KINDS_CARRYING_A_REASON)}))
         AND (reason IS NULL OR (kind, reason) IN (${KIND_REASON_PAIRS}))`,
      ),
    ),
    // The count never passes its ceiling, because the claim that would pass it poisons the
    // job instead — so a row with more attempts than it may have is a claim that got past
    // the rule.
    check(
      "job_attempts_check",
      sql.raw("attempts >= 0 AND max_attempts >= 1 AND attempts <= max_attempts"),
    ),
    // A claimant and its claim instant come together, and a *claimed* row carries the whole
    // of its lease — who holds it, since when, until when, and the last heartbeat — because a
    // claimed row missing one of them is a job nothing can heartbeat, finish or reclaim.
    check(
      "job_claim_check",
      sql.raw(
        `(claimed_by IS NULL) = (claimed_at IS NULL)
         AND (status <> '${JOB_CLAIMED_STATUS}'
              OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL
                  AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL))`,
      ),
    ),
    check(
      "job_finished_check",
      sql.raw(`(finished_at IS NOT NULL) = (status IN (${listed(JOB_TERMINAL_STATUSES)}))`),
    ),
    // The two finishes carry an outcome and nothing else does: a poisoned job ran nothing, so
    // it found nothing, and a done or failed job with no outcome would be a terminal row that
    // cannot say what the run it reports found.
    check(
      "job_outcome_check",
      sql.raw(`(outcome IS NOT NULL) = (status IN (${listed(JOB_FINISHED_STATUSES)}))`),
    ),
  ],
);
