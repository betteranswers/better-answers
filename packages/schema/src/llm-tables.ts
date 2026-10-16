import { sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import { questionAsked } from "./question-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const llmPurpose = pgEnum("llm_purpose", [
  "extraction",
  "enrichment",
  "answering",
  "judging",
  "embedding",
]);

export const MODEL_PROVIDERS = ["anthropic", "mistral", "cloudflare"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

const sealedFrame = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const modelKey = withRLS(
  "model_key",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    provider: text("provider").notNull(),
    sealed: sealedFrame("sealed").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.provider] }),
    check("model_key_provider_check", sql.raw(`provider IN (${listed(MODEL_PROVIDERS)})`)),
  ],
);

export const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export const DECIMAL_STRING = /^\d+(\.\d+)?$/;

export const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const LLM_CALL_OUTCOMES = ["succeeded", "failed"] as const;
export type LlmCallOutcome = (typeof LLM_CALL_OUTCOMES)[number];

export const LLM_CALL_FAILED = "failed" satisfies LlmCallOutcome;

const theCall = () => ({
  purpose: llmPurpose("purpose").notNull(),
  modelChoiceId: text("model_choice_id").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
});

export const llmCall = withRLS(
  "llm_call",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    id: text("id").notNull(),
    calledAt: stamp("called_at").notNull(),
    ...theCall(),
    seconds: doublePrecision("seconds").notNull(),
    costGbp: numeric("cost_gbp").notNull(),
    outcome: text("outcome").notNull(),
    runId: text("run_id"),
    answerId: text("answer_id"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    index("llm_call_workspace_id_called_at_idx").on(table.workspaceId, table.calledAt),
    foreignKey({
      name: "llm_call_answer_fk",
      columns: [table.workspaceId, table.answerId],
      foreignColumns: [questionAsked.workspaceId, questionAsked.id],
    }),
    check("llm_call_outcome_check", sql.raw(`outcome IN (${listed(LLM_CALL_OUTCOMES)})`)),
    check("llm_call_served_check", sql`(run_id IS NULL) <> (answer_id IS NULL)`),
    check(
      "llm_call_spend_check",
      sql`tokens_in >= 0 AND tokens_out >= 0 AND seconds >= 0 AND cost_gbp >= 0`,
    ),
  ],
);

export const spendReservation = withRLS(
  "spend_reservation",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    id: text("id").notNull(),
    takenAt: stamp("taken_at").notNull(),
    expiresAt: stamp("expires_at").notNull(),
    // Its tokens are the most the call may send and return, over every attempt.
    ...theCall(),
    gbpPerMillionIn: numeric("gbp_per_million_in").notNull(),
    gbpPerMillionOut: numeric("gbp_per_million_out").notNull(),
    reservedGbp: numeric("reserved_gbp").notNull(),
    runId: text("run_id"),
    answerId: text("answer_id"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    index("spend_reservation_expires_at_idx").on(table.workspaceId, table.expiresAt),
    foreignKey({
      name: "spend_reservation_answer_fk",
      columns: [table.workspaceId, table.answerId],
      foreignColumns: [questionAsked.workspaceId, questionAsked.id],
    }),
    check("spend_reservation_served_check", sql`(run_id IS NULL) <> (answer_id IS NULL)`),
    check(
      "spend_reservation_size_check",
      sql`tokens_in >= 0 AND tokens_out >= 0 AND gbp_per_million_in >= 0
          AND gbp_per_million_out >= 0 AND reserved_gbp >= 0 AND expires_at > taken_at`,
    ),
  ],
);

export const modelPrice = pgTable(
  "model_price",
  {
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    gbpPerMillionIn: numeric("gbp_per_million_in").notNull(),
    gbpPerMillionOut: numeric("gbp_per_million_out").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.model, table.effectiveFrom] }),
    check("model_price_provider_check", sql.raw(`provider IN (${listed(MODEL_PROVIDERS)})`)),
    check("model_price_rates_check", sql`gbp_per_million_in >= 0 AND gbp_per_million_out >= 0`),
  ],
);
