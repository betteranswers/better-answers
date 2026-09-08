import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, primaryKey, text } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
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

/**
 * The two job kinds this queue carries, which are T-006's own obligations: the **nightly
 * parser audit**, where the Python parser cross-checks the app's parse hash-by-hash, and
 * the **full rebuild**, the graph sync run that writes a new generation beside the live one
 * and flips it (`CONTEXT.md`, *graph sync run*; ADR 0023). B7 adds kinds to a loop that
 * exists; it does not add a loop.
 */
export const JOB_KINDS = ["nightly-audit", "full-rebuild"] as const;

/** The nightly cross-check of the two parsers (ADR 0012, ADR 0023). */
export const NIGHTLY_AUDIT_KIND = "nightly-audit" satisfies (typeof JOB_KINDS)[number];

/** The whole-graph rebuild, which is the only thing a generation exists for (ADR 0023). */
export const FULL_REBUILD_KIND = "full-rebuild" satisfies (typeof JOB_KINDS)[number];

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
 * What has become of a job. It is **queued** until a worker claims it; a *claimed* job holds
 * a *lease* (`CONTEXT.md`) it must keep confirming; it ends *done* or *failed* with an
 * outcome, or **poisoned** — claimed and lost as many times as it may be, so nothing claims
 * it again. Poisoning is the reaper's rule applied at claim time, which is what keeps an
 * expired lease from being lost and a poisoned job from being retried.
 */
export const JOB_STATUSES = ["queued", "claimed", "done", "failed", "poisoned"] as const;

/** What a job is born at: waiting for the worker that claims it. */
export const JOB_QUEUED_STATUS = "queued" satisfies (typeof JOB_STATUSES)[number];

/** Held by a worker under a lease, and the one status a heartbeat may refresh. */
export const JOB_CLAIMED_STATUS = "claimed" satisfies (typeof JOB_STATUSES)[number];

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
 * Never content, never an address and never a person's name (`[LOG1]`, `[AUDIT5]`): a job's
 * outcome is a record the platform keeps and would have to be rewritten on erasure if it
 * held one.
 *
 * A job is not an *audit event* and never becomes one (`[AUDIT8]`): runs are their own
 * record. There is no ledger row for enqueueing, claiming or finishing one.
 */
export const job = withRLS(
  "job",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    /** Why a rebuild is happening; NULL on every other kind (ADR 0023's six names). */
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
    check("job_kind_check", sql.raw(`kind IN (${listed(JOB_KINDS)})`)),
    check("job_status_check", sql.raw(`status IN (${listed(JOB_STATUSES)})`)),
    // A reason is a rebuild's and a rebuild always has one: the six names are what an
    // operator reads off a rebuild that happened, so a rebuild with none would be a row
    // that cannot say why the map was thrown away and made again.
    check(
      "job_reason_check",
      sql.raw(
        `(reason IS NOT NULL) = (kind = '${FULL_REBUILD_KIND}')
         AND (reason IS NULL OR reason IN (${listed(REBUILD_REASONS)}))`,
      ),
    ),
    // The count never passes its ceiling, because the claim that would pass it poisons the
    // job instead — so a row with more attempts than it may have is a claim that got past
    // the rule.
    check(
      "job_attempts_check",
      sql.raw("attempts >= 0 AND max_attempts >= 1 AND attempts <= max_attempts"),
    ),
    check("job_claim_check", sql.raw("(claimed_by IS NULL) = (claimed_at IS NULL)")),
    check(
      "job_finished_check",
      sql.raw(`(finished_at IS NOT NULL) = (status IN (${listed(JOB_TERMINAL_STATUSES)}))`),
    ),
    // A poisoned job ran nothing, so it found nothing: an outcome on one would be a report
    // about work that never happened.
    check(
      "job_outcome_check",
      sql.raw(`outcome IS NULL OR status IN (${listed(JOB_FINISHED_STATUSES)})`),
    ),
  ],
);
