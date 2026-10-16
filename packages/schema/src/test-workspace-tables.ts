import { text } from "drizzle-orm/pg-core";

import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

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
