import { index, primaryKey, text } from "drizzle-orm/pg-core";

import { stamp } from "./column-helpers.ts";
import { user } from "./identity-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/** Not a `member` column, so its stamp never waits on the holds every member action takes. */
export const workspaceLastActive = withRLS(
  "workspace_last_active",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),

    // No cascade: the platform never deletes a `user` row, so one promises a path that does not exist.
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    at: stamp("at").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_last_active_user_id_idx").on(table.userId),
  ],
);
