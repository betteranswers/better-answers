import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, text } from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN } from "./actor-id.ts";
import { listed, stamp } from "./column-helpers.ts";
import { attachedByIri } from "./concept-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";
import { writeUpVersion } from "./write-up-tables.ts";

export const USAGE_ACTS = ["copied", "exported", "submitted"] as const;

export const usage = withRLS(
  "usage",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    actor: text("actor").notNull(),
    at: stamp("at").notNull().defaultNow(),
    act: text("act").notNull(),
    writeUpId: text("write_up_id"),
    writeUpVersion: integer("write_up_version"),
    iri: text("iri"),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check("usage_actor_check", sql.raw(`actor ~ '^${ACTOR_ID_PATTERN}$'`)),
    check("usage_act_check", sql.raw(`act IN (${listed(USAGE_ACTS)})`)),
    check(
      "usage_one_target_check",
      sql.raw(
        "(write_up_id IS NOT NULL AND write_up_version IS NOT NULL AND iri IS NULL) OR (write_up_id IS NULL AND write_up_version IS NULL AND iri IS NOT NULL)",
      ),
    ),
    foreignKey({
      columns: [table.workspaceId, table.writeUpId, table.writeUpVersion],
      foreignColumns: [
        writeUpVersion.workspaceId,
        writeUpVersion.writeUpId,
        writeUpVersion.version,
      ],
      name: "usage_write_up_version_fk",
    }),
    index("usage_workspace_id_write_up_id_write_up_version_idx").on(
      table.workspaceId,
      table.writeUpId,
      table.writeUpVersion,
    ),
    attachedByIri(table, "usage_identity_fk"),
  ],
);
