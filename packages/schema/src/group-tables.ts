import {
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { member } from "./identity-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const GROUP_ORIGINS = ["admin-curated", "audience-minted"] as const;

export const CURATED_ORIGIN = "admin-curated" satisfies (typeof GROUP_ORIGINS)[number];

export const group = withRLS(
  "group",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    name: text("name").notNull(),
    origin: text("origin").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    uniqueIndex("group_workspace_id_name_uidx").on(table.workspaceId, table.name),

    unique("group_workspace_id_id_unique").on(table.workspaceId, table.id),
  ],
);

export const groupMember = withRLS(
  "group_member",
  {
    workspaceId: text("workspace_id").notNull(),
    groupId: text("group_id").notNull(),

    userId: text("user_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.groupId, table.userId] }),
    foreignKey({
      columns: [table.workspaceId, table.groupId],
      foreignColumns: [group.workspaceId, group.id],
      name: "group_member_group_fk",
    }).onDelete("cascade"),

    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [member.workspaceId, member.userId],
      name: "group_member_member_fk",
    }).onDelete("cascade"),

    index("group_member_workspace_id_user_id_idx").on(table.workspaceId, table.userId),
  ],
);
