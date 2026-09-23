import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import type { ROLES } from "./roles.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const NIGHTLY_AUDIT_KIND = "nightly-audit";

export const FULL_REBUILD_KIND = "full-rebuild";

export const INDEX_KIND = "index";

export const REBUILD_REASONS = [
  "first-sync",
  "route-change",
  "reconciler",
  "erasure",
  "upgrade",
  "drill",
] as const;

export const INDEX_REASONS = ["bound", "restored", "rule-change", "wiped"] as const;

// The store is the target-state tracking: rows deleted beside a store left standing are
// re-upserted by nothing, the engine believing them landed.
export const REASONS_EMPTYING_THE_BINDING = [
  "rule-change",
  "wiped",
] as const satisfies readonly (typeof INDEX_REASONS)[number][];

export type ClaimingTier = "api" | "worker";

export type JobKindDescriptor = {
  readonly kind: string;

  readonly claimingTier: ClaimingTier;

  readonly namesASubject: boolean;

  readonly reasons: readonly string[];

  readonly enqueuedBy: (typeof ROLES)[number];
};

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

export const JOB_KINDS = JOB_KIND_DESCRIPTORS.map((descriptor) => descriptor.kind);

export const JOB_REASONS = JOB_KIND_DESCRIPTORS.flatMap((descriptor) => [...descriptor.reasons]);

const KINDS_NAMING_A_SUBJECT = JOB_KIND_DESCRIPTORS.filter(
  (descriptor) => descriptor.namesASubject,
).map((descriptor) => descriptor.kind);

const KINDS_CARRYING_A_REASON = JOB_KIND_DESCRIPTORS.filter(
  (descriptor) => descriptor.reasons.length > 0,
).map((descriptor) => descriptor.kind);

const KIND_REASON_PAIRS = JOB_KIND_DESCRIPTORS.flatMap((descriptor) =>
  descriptor.reasons.map((reason) => `('${descriptor.kind}', '${reason}')`),
).join(", ");

export const JOB_STATUSES = ["queued", "claimed", "done", "failed", "poisoned"] as const;

export const JOB_QUEUED_STATUS = "queued" satisfies (typeof JOB_STATUSES)[number];

export const JOB_CLAIMED_STATUS = "claimed" satisfies (typeof JOB_STATUSES)[number];

export const JOB_DONE_STATUS = "done" satisfies (typeof JOB_STATUSES)[number];

export const JOB_TERMINAL_STATUSES = ["done", "failed", "poisoned"] as const;

export const JOB_FINISHED_STATUSES = ["done", "failed"] as const;

export const JOB_MAX_ATTEMPTS = 3;

export const job = withRLS(
  "job",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),

    subjectId: text("subject_id"),

    reason: text("reason"),
    status: text("status").notNull().default(JOB_QUEUED_STATUS),

    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(JOB_MAX_ATTEMPTS),
    enqueuedAt: stamp("enqueued_at").notNull().defaultNow(),

    claimedBy: text("claimed_by"),
    claimedAt: stamp("claimed_at"),

    leaseExpiresAt: stamp("lease_expires_at"),

    heartbeatAt: stamp("heartbeat_at"),
    finishedAt: stamp("finished_at"),
    outcome: jsonb("outcome"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),

    index("job_workspace_id_status_enqueued_at_idx").on(
      table.workspaceId,
      table.status,
      table.enqueuedAt,
    ),

    uniqueIndex("job_queued_subject_key")
      .on(table.workspaceId, table.kind, table.subjectId)
      .where(sql.raw(`status = '${JOB_QUEUED_STATUS}'`)),
    check("job_kind_check", sql.raw(`kind IN (${listed(JOB_KINDS)})`)),
    check("job_status_check", sql.raw(`status IN (${listed(JOB_STATUSES)})`)),

    check(
      "job_subject_check",
      sql.raw(`(subject_id IS NOT NULL) = (kind IN (${listed(KINDS_NAMING_A_SUBJECT)}))`),
    ),

    check(
      "job_reason_check",
      sql.raw(
        `(reason IS NOT NULL) = (kind IN (${listed(KINDS_CARRYING_A_REASON)}))
         AND (reason IS NULL OR (kind, reason) IN (${KIND_REASON_PAIRS}))`,
      ),
    ),

    check(
      "job_attempts_check",
      sql.raw("attempts >= 0 AND max_attempts >= 1 AND attempts <= max_attempts"),
    ),

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

    check(
      "job_outcome_check",
      sql.raw(`(outcome IS NOT NULL) = (status IN (${listed(JOB_FINISHED_STATUSES)}))`),
    ),
  ],
);
