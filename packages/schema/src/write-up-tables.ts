import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, text } from "drizzle-orm/pg-core";

import { attachedByIri } from "./concept-tables.ts";
import { readableRecordColumns, readableUnitChecks } from "./readable-columns.ts";
import { withRLS } from "./with-rls.ts";

export const writeUp = withRLS(
  "write_up",

  readableRecordColumns(),
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    ...readableUnitChecks("write_up"),
  ],
);

export const writeUpInclude = withRLS(
  "write_up_include",
  {
    workspaceId: text("workspace_id").notNull(),
    writeUpId: text("write_up_id").notNull(),
    id: text("id").notNull(),
    ordinal: integer("ordinal").notNull(),

    iri: text("iri").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.writeUpId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.writeUpId],
      foreignColumns: [writeUp.workspaceId, writeUp.id],
      name: "write_up_include_write_up_fk",
    }).onDelete("cascade"),

    attachedByIri(table, "write_up_include_identity_fk"),

    index("write_up_include_workspace_id_iri_idx").on(table.workspaceId, table.iri),
    check("write_up_include_ordinal_check", sql.raw("ordinal >= 0")),
  ],
);
