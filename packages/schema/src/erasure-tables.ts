import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import { user } from "./identity-tables.ts";
import { sourceDocument } from "./source-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const SUBJECT_REQUEST_KINDS = ["access", "erasure"] as const;

export const SUBJECT_IDENTIFIER_KINDS = ["emails", "names", "other"] as const;

export const SUBJECT_IDENTIFIER_MAX = 320;
export const SUBJECT_IDENTIFIERS_MAX = 50;

const identifierSetIsShaped = [
  `jsonb_typeof(identifiers) = 'object'`,
  ...SUBJECT_IDENTIFIER_KINDS.map(
    (kind) => `jsonb_typeof(identifiers -> '${kind}') IS NOT DISTINCT FROM 'array'`,
  ),
].join("\n         AND ");

const identifierSetSize = SUBJECT_IDENTIFIER_KINDS.map(
  (kind) => `jsonb_array_length(identifiers -> '${kind}')`,
).join(" + ");

export const subjectRequest = withRLS(
  "subject_request",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),

    personId: text("person_id").references(() => user.id),

    identifiers: jsonb("identifiers").notNull(),
    kind: text("kind").notNull(),
    receivedAt: stamp("received_at").notNull(),

    clockStartedAt: stamp("clock_started_at").notNull(),
    dueAt: stamp("due_at").notNull(),

    extendedTo: stamp("extended_to"),

    answeredAt: stamp("answered_at"),
    answer: text("answer"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check("subject_request_kind_check", sql.raw(`kind IN (${listed(SUBJECT_REQUEST_KINDS)})`)),

    check("subject_request_identifiers_check", sql.raw(identifierSetIsShaped)),

    check(
      "subject_request_subject_check",
      sql.raw(`person_id IS NOT NULL OR ${identifierSetSize} > 0`),
    ),

    check(
      "subject_request_clock_check",
      sql.raw(
        `clock_started_at >= received_at
         AND due_at > clock_started_at
         AND (extended_to IS NULL OR extended_to > due_at)`,
      ),
    ),

    check("subject_request_answer_check", sql.raw("(answered_at IS NULL) = (answer IS NULL)")),
  ],
);

export const erasureRequest = withRLS(
  "erasure_request",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    subjectRequestId: text("subject_request_id").notNull(),

    pseudonym: text("pseudonym").notNull(),

    lockedAt: stamp("locked_at").notNull(),

    actions: jsonb("actions").notNull().default({}),
    anchoredAt: stamp("anchored_at").notNull(),
    beyondUseHourlyAt: stamp("beyond_use_hourly_at").notNull(),
    beyondUseDailyAt: stamp("beyond_use_daily_at").notNull(),
    beyondUseWeeklyAt: stamp("beyond_use_weekly_at").notNull(),
    beyondUseMonthlyAt: stamp("beyond_use_monthly_at").notNull(),

    completedAt: stamp("completed_at"),
    report: text("report"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),

    foreignKey({
      columns: [table.workspaceId, table.subjectRequestId],
      foreignColumns: [subjectRequest.workspaceId, subjectRequest.id],
      name: "erasure_request_subject_request_fk",
    }).onDelete("cascade"),

    uniqueIndex("erasure_request_subject_request_uidx").on(
      table.workspaceId,
      table.subjectRequestId,
    ),

    uniqueIndex("erasure_request_pseudonym_uidx").on(table.workspaceId, table.pseudonym),

    check("erasure_request_actions_check", sql.raw("jsonb_typeof(actions) = 'object'")),

    check(
      "erasure_request_beyond_use_check",
      sql.raw(
        `beyond_use_hourly_at > anchored_at
         AND beyond_use_daily_at > beyond_use_hourly_at
         AND beyond_use_weekly_at > beyond_use_daily_at
         AND beyond_use_monthly_at > beyond_use_weekly_at`,
      ),
    ),

    check("erasure_request_completion_check", sql.raw("(completed_at IS NULL) = (report IS NULL)")),
  ],
);

export const suppression = withRLS(
  "suppression",
  {
    workspaceId: text("workspace_id").notNull(),
    erasureRequestId: text("erasure_request_id").notNull(),
    documentId: text("document_id").notNull(),

    identifiers: jsonb("identifiers").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.erasureRequestId, table.documentId] }),

    foreignKey({
      columns: [table.workspaceId, table.erasureRequestId],
      foreignColumns: [erasureRequest.workspaceId, erasureRequest.id],
      name: "suppression_erasure_request_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.documentId],
      foreignColumns: [sourceDocument.workspaceId, sourceDocument.id],
      name: "suppression_document_fk",
    }).onDelete("cascade"),

    index("suppression_workspace_id_document_id_idx").on(table.workspaceId, table.documentId),

    check(
      "suppression_identifiers_check",
      sql.raw(`${identifierSetIsShaped}\n         AND ${identifierSetSize} > 0`),
    ),
  ],
);
