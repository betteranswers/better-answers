import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN } from "./actor-id.ts";
import { listed, stamp } from "./column-helpers.ts";
import { sourceDocument } from "./source-tables.ts";
import { withRLS } from "./with-rls.ts";

/**
 * The **finding** (`CONTEXT.md`; ADR 0020): what the redaction seam found in one source
 * document — one row per span — as the sources slice's own record. The worker writes it and
 * the app reviews it, which is the tier boundary the S0 spec draws: the detector runs in the
 * worker, the review of a finding is an Admin's act, and `worker_rt` therefore holds INSERT
 * on this table and nothing else — granted in its substrate migration, with a refusal test
 * per road it does not hold, as every cross-tier grant in this package carries.
 *
 * **It never holds the value.** A category, a tier, a rule id, two offsets into the
 * normalised text and a score — there is no column a name, an address, an account number or
 * a sentence of the document could sit in, and there is not meant to be one. That is what
 * makes a finding safe to keep for as long as the document lives, safe to show on a review
 * screen, and nothing an erasure has to rewrite: the span is located, never quoted. The
 * column set is written down as a literal in `test/boundary-schemas.test.ts`, so a column
 * that could carry a value cannot arrive unnoticed.
 *
 * **Two acts leave their mark here** and neither is the worker's: the review — *kept in
 * text* or *narrowed*, with the acting Admin and the instant — and, for the always set
 * alone, the restore of one span with a reason (`sources.finding.restored`). The reprocess
 * that lets a restored span back into the text is S1's, keyed on the finding.
 */

/**
 * The three tiers of the glossary's *redaction rule*, the one closed list: **always** is
 * policy and no binding switches it off, and the two defaults are per binding. What each
 * tier withholds and under which placeholder word is the `redaction` agreement's, in
 * `contracts/` — nothing imports it (ADR 0031), and no category list belongs in a migration.
 */
export const REDACTION_TIERS = ["always", "default-on", "default-off"] as const;

/** The tier a binding cannot switch off, and so the only tier a restore applies to. */
export const REDACTION_ALWAYS_TIER = "always" satisfies (typeof REDACTION_TIERS)[number];

/** The three states a finding's review passes through, born at the first. */
export const FINDING_REVIEW_STATES = ["unreviewed", "kept-in-text", "narrowed"] as const;

/** The state a finding is born at — the seam found it and nobody has looked yet. */
export const FINDING_UNREVIEWED_STATE =
  "unreviewed" satisfies (typeof FINDING_REVIEW_STATES)[number];

/**
 * How long a reason may be, on a review and on a restore alike. A sentence of why, as
 * `ACCESS_REQUEST_REASON_MAX` bounds one: the columns are text, so the bound is the
 * boundary's, and it is stated here because both acts write into the same shape.
 */
export const FINDING_REASON_MAX = 1_000;

export const finding = withRLS(
  "finding",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    /** The document the span sits in — what the seam ran over, and what a review reads by. */
    documentId: text("document_id").notNull(),
    /** The category the rule raised, in the `redaction` agreement's words. */
    category: text("category").notNull(),
    tier: text("tier").notNull(),
    /** The declared rule that raised it, so a rule change can find what that rule found. */
    ruleId: text("rule_id").notNull(),
    /** The span, in code points into the normalised text — a location, never a quotation. */
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    /** The detector's confidence, as Presidio reports one: nought to one. */
    score: doublePrecision("score").notNull(),
    /** The two halves of the version string a re-detection re-baselines against. */
    ruleVersion: text("rule_version").notNull(),
    detectorPin: text("detector_pin").notNull(),
    reviewState: text("review_state").notNull().default(FINDING_UNREVIEWED_STATE),
    /** The three columns a review writes, all null until an Admin takes one. */
    reviewedBy: text("reviewed_by"),
    reviewedAt: stamp("reviewed_at"),
    reviewReason: text("review_reason"),
    /** The three a restore writes — the always set's alone, and each with the others. */
    restoredAt: stamp("restored_at"),
    restoredBy: text("restored_by"),
    restoreReason: text("restore_reason"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    // Keyed by the pair, as every cross-table key in this package is: a foreign-key check
    // bypasses row-level security, so a key on the document id alone would confirm that some
    // other tenant holds a given document. A document that leaves takes its findings with it.
    foreignKey({
      columns: [table.workspaceId, table.documentId],
      foreignColumns: [sourceDocument.workspaceId, sourceDocument.id],
      name: "finding_document_fk",
    }).onDelete("cascade"),
    // The review's own read: every finding in one document, which is what a review screen
    // and the publish dialog's counts both open with.
    index("finding_workspace_id_document_id_idx").on(table.workspaceId, table.documentId),
    check("finding_tier_check", sql.raw(`tier IN (${listed(REDACTION_TIERS)})`)),
    check(
      "finding_review_state_check",
      sql.raw(`review_state IN (${listed(FINDING_REVIEW_STATES)})`),
    ),
    // A span is a half-open range into text that exists, so it starts at or after the
    // beginning and ends after it starts. A finding whose offsets said otherwise would point
    // a reviewer at nothing, and S1's `passageAt` would resolve it to nothing too.
    check("finding_span_check", sql.raw("char_start >= 0 AND char_end > char_start")),
    // The detector's own range. A score outside it is a detector that changed its scale
    // without saying so, and every threshold in the descriptors would be reading it wrong.
    check("finding_score_check", sql.raw("score >= 0 AND score <= 1")),
    // A review is an act, and an act has an actor and an instant: a state that moved with
    // neither beside it would be a reviewed span the screen cannot say who reviewed, and an
    // unreviewed row carrying a reason would be a review nobody took.
    check(
      "finding_review_check",
      sql.raw(
        `(review_state = '${FINDING_UNREVIEWED_STATE}') = (reviewed_at IS NULL)
         AND (reviewed_at IS NULL) = (reviewed_by IS NULL)
         AND (review_reason IS NULL OR reviewed_at IS NOT NULL)`,
      ),
    ),
    // The restore's three come together — the act is refused without a reason — and only the
    // always set is restorable, because the two default tiers are switched at the binding
    // rather than span by span. The act's refusal, made the database's.
    check(
      "finding_restore_check",
      sql.raw(
        `(restored_at IS NULL) = (restored_by IS NULL)
         AND (restored_at IS NULL) = (restore_reason IS NULL)
         AND (restored_at IS NULL OR tier = '${REDACTION_ALWAYS_TIER}')`,
      ),
    ),
    // Both actors are the ledger's own actor shape, so whoever reviewed and whoever restored
    // read the same way here as they do on the audit row that records the act.
    check(
      "finding_actor_check",
      sql.raw(
        `(reviewed_by IS NULL OR reviewed_by ~ '^${ACTOR_ID_PATTERN}$')
         AND (restored_by IS NULL OR restored_by ~ '^${ACTOR_ID_PATTERN}$')`,
      ),
    ),
  ],
);
