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
// No table of its own: the visibility vocabulary and the column sets more than one table file
// writes, in a module neither the concept write path nor the source catalogue can import in a
// circle (`readable-columns.ts`). Re-exported here so the package's entry point carries the
// words, which is where `packages/core` reads them from.
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
    /**
     * The **retention tail**: how long this route's provider says it keeps what is sent to
     * it, in the provider's own words, as the *DPIA input* prints them (the S0 spec, *The
     * DPIA input*; ADR 0020 amending ADR 0013). Text and not a duration, because what a DPIA
     * has to carry is the statement the platform is relying on — *zero retention*, *30 days
     * for abuse monitoring* — and a number would be this platform's reading of somebody
     * else's promise. NULL until it is read: S2's model client fills it, and v0.1 calls no
     * route, so the document says the tail is not yet recorded rather than inventing one.
     */
    retentionTail: text("retention_tail"),
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
 * A workspace's thresholds as rows (ADR 0025): today `mcp.tools_list_ttl_ms`,
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
