import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const FAMILIES = ["people", "knowledge", "sources", "platform"] as const;

export const ACT_PATTERN = `^(${FAMILIES.join("|")})\\.[a-z][a-z_]*\\.[a-z][a-z_]*$`;

export const ACT = new RegExp(ACT_PATTERN);

const familyList = FAMILIES.map((family) => `'${family}'`).join(", ");

// Both ledgers name an act the same way and carry the same row after the key.
const ledgerColumns = () => ({
  act: text("act").notNull(),

  family: text("family")
    .notNull()
    .generatedAlwaysAs(sql`split_part(act, '.', 1)`),

  actor: text("actor").notNull(),

  subjectKind: text("subject_kind")
    .notNull()
    .generatedAlwaysAs(sql`split_part(act, '.', 2)`),
  subjectId: text("subject_id").notNull(),
  at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),

  detail: jsonb("detail").notNull(),

  batchId: text("batch_id"),
});

const ledgerChecks = (table: string) => [
  check(`${table}_act_check`, sql.raw(`act ~ '${ACT_PATTERN}'`)),
  check(`${table}_family_check`, sql.raw(`family IN (${familyList})`)),
];

export const auditEvent = withRLS(
  "audit_event",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    ...ledgerColumns(),
  },
  "workspaceId",
  (table) => [
    index("audit_event_workspace_id_idx").on(table.workspaceId),

    index("audit_event_subject_idx").on(table.workspaceId, table.subjectKind, table.subjectId),

    uniqueIndex("audit_event_workspace_id_id_uidx").on(table.workspaceId, table.id),
    ...ledgerChecks("audit_event"),
  ],
);

// An act on the identity set belongs to no workspace, so no workspace's scope can hold its row.
export const identityAuditEvent = pgTable(
  "identity_audit_event",
  {
    id: text("id").primaryKey(),
    ...ledgerColumns(),
  },
  (table) => [
    index("identity_audit_event_subject_idx").on(table.subjectKind, table.subjectId),
    ...ledgerChecks("identity_audit_event"),
  ],
);
