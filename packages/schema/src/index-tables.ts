import { customType, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The `index` schema's declarations live in their own module, deliberately outside
 * `drizzle.config.ts`'s `schema` file: drizzle-kit generates DDL for everything the
 * config file reaches (its `schemaFilter` does not exclude a `pgSchema` table), and
 * `index`'s DDL is hand-written SQL in the same journal (ADR 0032). These declarations
 * exist for types and boundary schemas (ADR 0028); the worker-view drift test asserts
 * they and the migrated database never disagree.
 */

export const indexSchema = pgSchema("index");

/**
 * The vector width, `vector(N)`: N is the day-one embedding route's model —
 * `mistral-embed`, whose output is fixed at 1024 dimensions (Mistral platform docs,
 * read 01/09/2026; the hosted Mistral EU route is ADR 0020's amendment).
 * The one place the number lives: the column type, the boundary
 * refinement and the test factory import it. The migration's `vector(1024)` is the
 * hand-written DDL this declaration mirrors; the worker-view drift test holds them equal.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * A `customType`, and therefore ADR 0028's one plain-schema exception: its boundary
 * schema must never be written as a callback, which throws `TypeError` at module
 * evaluation on custom columns.
 */
const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${EMBEDDING_DIMENSIONS})`,
  toDriver: (value) => JSON.stringify(value),
  // SAFETY: pgvector's text output is a JSON-compatible number array ("[1,2,3]"),
  // so parsing the driver's string yields number[] by the column's own contract.
  fromDriver: (value) => JSON.parse(value) as number[],
});

/**
 * Declared, not generated: the real DDL is the hand-written migration's `PARTITION BY
 * LIST (workspace_id)` parent (drizzle-orm 0.45.2 has no partitioning API — ADR 0028
 * assertion 4's note), whose per-workspace partitions and HNSW indexes are created by
 * the one SECURITY DEFINER lifecycle function.
 */
export const chunk = indexSchema.table("chunk", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  content: text("content").notNull(),
  embedding: embeddingVector("embedding").notNull(),
  embeddingRouteId: text("embedding_route_id").notNull(),
  // The three visibility columns every readable unit carries (ADR 0023).
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  sensitivity: text("sensitivity").notNull(),
  audience: text("audience").notNull(),
  // On every chunk row: a chunk is always source-derived (ADR 0023 puts `binding_id`
  // on source-derived rows; canonical entities, which carry none, have no chunks).
  bindingId: text("binding_id").notNull(),
});
