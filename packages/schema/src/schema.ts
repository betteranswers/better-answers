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

/**
 * The `public` schema Drizzle owns (ADR 0007, ADR 0032). Only what this file reaches
 * is *generated*: the `index` schema's declarations live in `index-tables.ts` and the
 * two UNLOGGED counters in `counter-tables.ts`, both outside the drizzle config's
 * `schema` path, because their DDL is hand-written SQL in the same journal. The
 * identity set (`identity-tables.ts`) and `workspace` are re-exported here so
 * drizzle-kit generates them.
 */

export { workspace } from "./workspace-table.ts";
export * from "./identity-tables.ts";

/** The five route purposes (briefing 16's record family; ADR 0031's llm-routing). */
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
    // The embedding route's dimension count; NULL on every other purpose.
    dimensions: integer("dimensions"),
  },
  "workspaceId",
  (table) => [
    // One route per workspace per purpose — what lets `llm_route_for` resolve to at
    // most one row (ADR 0031: "resolved by the database, never twice in code").
    uniqueIndex("llm_route_workspace_purpose_unique").on(table.workspaceId, table.purpose),
    // The embedding route carries its dimension count and no other purpose does —
    // the column comment's claim, made the database's.
    check(
      "llm_route_dimensions_check",
      sql`(purpose = 'embedding') = (dimensions IS NOT NULL) AND (dimensions IS NULL OR dimensions > 0)`,
    ),
  ],
);

/**
 * A workspace's thresholds as rows (ADR 0025, `[OPS1]`): today `mcp.tools_list_ttl_ms`,
 * seeded by workspace provisioning. A tenant table like any other.
 */
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
