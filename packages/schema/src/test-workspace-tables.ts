import { text } from "drizzle-orm/pg-core";

import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/** A row of its own, not a workspace column, so no act on the workspace can lift it. */
export const testWorkspaceMark = withRLS(
  "test_workspace_mark",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspace.id, { onDelete: "cascade" }),

    testingDomain: text("testing_domain").notNull(),
  },
  "workspaceId",
);
