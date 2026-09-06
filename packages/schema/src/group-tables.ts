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

/**
 * The one grouping shape (`CONTEXT.md`, *group*; ADR 0038): a named set of members of one
 * workspace, flat, a person in several at once. Membership changes only what a person may
 * *see*, through audiences, never what they may *do* — which is why neither table below
 * carries a role or a permission column, and why the resolver reads `group_member` for
 * ids alone.
 *
 * Both are ordinary tenant tables (`withRLS()`, ADR 0032), and both are the members
 * slice's (`packages/core/src/members`), which is what the table-ownership map records.
 *
 * `group` is a reserved word in SQL, so every statement that names it writes it quoted —
 * `"group"` — exactly as `"user"` already is. Drizzle quotes it in the DDL it generates;
 * hand-written SQL in the slice and in the tests has to say so itself.
 */

/**
 * Where a group came from: an Admin made it, or a Restricted binding's named-people
 * audience minted it (ADR 0038). A wide text column narrowed at the boundary to this
 * closed pair, exactly as *sensitivity* is — the set is the boundary's to hold, so a
 * later kind is one line there and no migration.
 *
 * **Nothing mints the audience-minted kind yet**: the discriminator exists so that the
 * binding-management surface which will has nowhere else to put it, and so no second
 * grouping shape is ever needed. Every group written today is Admin-curated.
 */
export const GROUP_ORIGINS = ["admin-curated", "audience-minted"] as const;

/** The origin a group an Admin made carries — the only kind anything mints today. */
export const CURATED_ORIGIN = "admin-curated" satisfies (typeof GROUP_ORIGINS)[number];

export const group = withRLS(
  "group",
  {
    // Platform-minted, no default: T-006's `audience_groups` refinement assumes this
    // shape, so the minter's ULID is the id a binding's audience will hold.
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
    // One "HR team" per workspace, and the index the create and rename acts read their
    // `name-taken` refusal off.
    uniqueIndex("group_workspace_id_name_uidx").on(table.workspaceId, table.name),
    // The target of `group_member`'s composite foreign key. A key on `id` alone would let
    // a foreign-key check — which runs as the table's owner and bypasses RLS — confirm
    // that some other tenant holds a given group id; keyed by the pair, the check can only
    // ever succeed inside the workspace the referring row already names.
    //
    // A `UNIQUE` constraint rather than a unique index, because drizzle-kit emits every
    // foreign key before every `CREATE INDEX`: a unique index here would be created after
    // the key that references it, and the migration would not apply.
    unique("group_workspace_id_id_unique").on(table.workspaceId, table.id),
  ],
);

export const groupMember = withRLS(
  "group_member",
  {
    workspaceId: text("workspace_id").notNull(),
    groupId: text("group_id").notNull(),
    // The *person* id, not the membership row's id (T-063): the resolver already holds a
    // person id and a workspace id, so keying by them is the lookup it can make without
    // a join, and the composite key to `member` below is what ties the two together.
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
    // Leaving the workspace leaves every group in it: the pair references the membership
    // pair, so a deleted `member` row takes its group rows with it, and no orphan can
    // outlive the membership it described.
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [member.workspaceId, member.userId],
      name: "group_member_member_fk",
    }).onDelete("cascade"),
    // The resolver's read — this person's group ids in this workspace, on every call
    // (ADR 0009) — which the primary key's column order cannot serve; it is also the
    // index the membership cascade above scans.
    index("group_member_workspace_id_user_id_idx").on(table.workspaceId, table.userId),
  ],
);
