import { sql } from "drizzle-orm";
import { check, index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const FAMILIES = ["people", "knowledge", "sources", "platform"] as const;

export const ACT_PATTERN = `^(${FAMILIES.join("|")})\\.[a-z][a-z_]*\\.[a-z][a-z_]*$`;

export const ACT = new RegExp(ACT_PATTERN);

const familyList = FAMILIES.map((family) => `'${family}'`).join(", ");

export const auditEvent = withRLS(
  "audit_event",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
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
  },
  "workspaceId",
  (table) => [
    index("audit_event_workspace_id_idx").on(table.workspaceId),

    index("audit_event_subject_idx").on(table.workspaceId, table.subjectKind, table.subjectId),

    uniqueIndex("audit_event_workspace_id_id_uidx").on(table.workspaceId, table.id),
    check("audit_event_act_check", sql.raw(`act ~ '${ACT_PATTERN}'`)),
    check("audit_event_family_check", sql.raw(`family IN (${familyList})`)),
  ],
);
