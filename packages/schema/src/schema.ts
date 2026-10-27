import { sql } from "drizzle-orm";
import { check, integer, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

import { stamp } from "./column-helpers.ts";
import { workspace } from "./people/workspace-table.ts";
import { llmPurpose } from "./platform/llm-tables.ts";
import { withRLS } from "./with-rls.ts";

export { workspace } from "./people/workspace-table.ts";

export * from "./knowledge/readable-columns.ts";
export * from "./people/identity-tables.ts";
export * from "./people/audit-tables.ts";
export * from "./people/group-tables.ts";
export * from "./people/access-request-tables.ts";
export * from "./people/last-active-tables.ts";
export * from "./people/test-workspace-tables.ts";
export * from "./knowledge/concept-tables.ts";
export * from "./knowledge/suggestion-tables.ts";
export * from "./sources/source-tables.ts";
export * from "./sources/finding-tables.ts";
export * from "./sources/erasure-tables.ts";
export * from "./knowledge/guide-tables.ts";
export * from "./knowledge/write-up-tables.ts";
export * from "./knowledge/usage-tables.ts";
export * from "./knowledge/question-tables.ts";
export * from "./platform/llm-tables.ts";
export * from "./platform/job-tables.ts";
export * from "./platform/platform-tables.ts";

export const modelChoice = withRLS(
  "model_choice",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    purpose: llmPurpose("purpose").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),

    dimensions: integer("dimensions"),

    retentionTail: text("retention_tail"),
  },
  "workspaceId",
  (table) => [
    uniqueIndex("model_choice_workspace_purpose_unique").on(table.workspaceId, table.purpose),

    check(
      "model_choice_dimensions_check",
      sql`(purpose = 'embedding') = (dimensions IS NOT NULL) AND (dimensions IS NULL OR dimensions > 0)`,
    ),
  ],
);

export const workspaceConfig = withRLS(
  "workspace_config",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: stamp("updated_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })],
);
