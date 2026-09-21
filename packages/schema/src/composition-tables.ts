import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, text } from "drizzle-orm/pg-core";

import { conceptIdentity } from "./concept-tables.ts";
import { readableRecordColumns, readableUnitChecks } from "./readable-columns.ts";
import { withRLS } from "./with-rls.ts";

export const composition = withRLS(
  "composition",

  readableRecordColumns(),
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    ...readableUnitChecks("composition"),
  ],
);

export const compositionInclude = withRLS(
  "composition_include",
  {
    workspaceId: text("workspace_id").notNull(),
    compositionId: text("composition_id").notNull(),
    id: text("id").notNull(),
    ordinal: integer("ordinal").notNull(),

    iri: text("iri").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.compositionId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.compositionId],
      foreignColumns: [composition.workspaceId, composition.id],
      name: "composition_include_composition_fk",
    }).onDelete("cascade"),

    foreignKey({
      columns: [table.workspaceId, table.iri],
      foreignColumns: [conceptIdentity.workspaceId, conceptIdentity.iri],
      name: "composition_include_identity_fk",
    }).onDelete("cascade"),

    index("composition_include_workspace_id_iri_idx").on(table.workspaceId, table.iri),
    check("composition_include_ordinal_check", sql.raw("ordinal >= 0")),
  ],
);
