import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgEnum,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export { workspace } from "./workspace-table.ts";

export * from "./readable-columns.ts";
export * from "./identity-tables.ts";
export * from "./audit-tables.ts";
export * from "./group-tables.ts";
export * from "./access-request-tables.ts";
export * from "./concept-tables.ts";
export * from "./suggestion-tables.ts";
export * from "./source-tables.ts";
export * from "./finding-tables.ts";
export * from "./erasure-tables.ts";
export * from "./composition-tables.ts";
export * from "./job-tables.ts";

export const llmPurpose = pgEnum("llm_purpose", [
  "extraction",
  "enrichment",
  "answering",
  "judging",
  "embedding",
]);

export const llmRoute = withRLS(
  "llm_route",
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
    uniqueIndex("llm_route_workspace_purpose_unique").on(table.workspaceId, table.purpose),

    check(
      "llm_route_dimensions_check",
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
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })],
);
