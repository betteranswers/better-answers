import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  integer,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN } from "./actor-id.ts";
import { listed, stamp } from "./column-helpers.ts";
import { sourceDocument } from "./source-tables.ts";
import { withRLS } from "./with-rls.ts";

export const REDACTION_TIERS = ["always", "default-on", "default-off"] as const;

export const REDACTION_ALWAYS_TIER = "always" satisfies (typeof REDACTION_TIERS)[number];

export const FINDING_REVIEW_STATES = [
  "unreviewed",
  "kept-in-text",
  "narrowed",
  "dismissed",
] as const;

export const FINDING_UNREVIEWED_STATE =
  "unreviewed" satisfies (typeof FINDING_REVIEW_STATES)[number];

export const FINDING_DISMISSED_STATE = "dismissed" satisfies (typeof FINDING_REVIEW_STATES)[number];

export const FINDING_REASON_MAX = 1_000;

export const finding = withRLS(
  "finding",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),

    documentId: text("document_id").notNull(),

    category: text("category").notNull(),
    tier: text("tier").notNull(),

    ruleId: text("rule_id").notNull(),

    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),

    score: doublePrecision("score").notNull(),

    ruleVersion: text("rule_version").notNull(),
    detectorPin: text("detector_pin").notNull(),
    reviewState: text("review_state").notNull().default(FINDING_UNREVIEWED_STATE),

    reviewedBy: text("reviewed_by"),
    reviewedAt: stamp("reviewed_at"),
    reviewReason: text("review_reason"),

    restoredAt: stamp("restored_at"),
    restoredBy: text("restored_by"),
    restoreReason: text("restore_reason"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),

    foreignKey({
      columns: [table.workspaceId, table.documentId],
      foreignColumns: [sourceDocument.workspaceId, sourceDocument.id],
      name: "finding_document_fk",
    }).onDelete("cascade"),

    uniqueIndex("finding_span_key").on(
      table.workspaceId,
      table.documentId,
      table.ruleId,
      table.charStart,
      table.charEnd,
    ),
    check("finding_tier_check", sql.raw(`tier IN (${listed(REDACTION_TIERS)})`)),
    check(
      "finding_review_state_check",
      sql.raw(`review_state IN (${listed(FINDING_REVIEW_STATES)})`),
    ),

    check("finding_span_check", sql.raw("char_start >= 0 AND char_end > char_start")),

    check("finding_score_check", sql.raw("score >= 0 AND score <= 1")),

    check(
      "finding_review_check",
      sql.raw(
        `(review_state = '${FINDING_UNREVIEWED_STATE}') = (reviewed_at IS NULL)
         AND (reviewed_at IS NULL) = (reviewed_by IS NULL)
         AND (review_reason IS NULL OR reviewed_at IS NOT NULL)`,
      ),
    ),

    check(
      "finding_restore_check",
      sql.raw(
        `(restored_at IS NULL) = (restored_by IS NULL)
         AND (restored_at IS NULL) = (restore_reason IS NULL)
         AND (restored_at IS NULL OR tier = '${REDACTION_ALWAYS_TIER}')`,
      ),
    ),

    check(
      "finding_actor_check",
      sql.raw(
        `(reviewed_by IS NULL OR reviewed_by ~ '^${ACTOR_ID_PATTERN}$')
         AND (restored_by IS NULL OR restored_by ~ '^${ACTOR_ID_PATTERN}$')`,
      ),
    ),
  ],
);
