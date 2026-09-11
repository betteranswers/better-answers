import { sql } from "drizzle-orm";
import { customType, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

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
 * The full-text vector over a chunk's content, in the English configuration (migration 0035).
 * A `customType` for the same reason the embedding is one — drizzle-orm 0.45.2 declares no
 * `tsvector` — and therefore ADR 0028's plain-schema exception again. The driver hands the
 * column back as text, which is the only form it ever takes on this side of the boundary:
 * neither tier writes it, and the reads that use it match against it in SQL.
 */
const searchVector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/**
 * Declared, not generated: the real DDL is the hand-written migration's `PARTITION BY
 * LIST (workspace_id)` parent (drizzle-orm 0.45.2 has no partitioning API — ADR 0028
 * assertion 4's note), whose per-workspace partitions and full-text indexes are created by
 * the one SECURITY DEFINER lifecycle function.
 */
export const chunk = indexSchema.table("chunk", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  content: text("content").notNull(),
  // Nullable together, and kept together by the row's own CHECK (migration 0035): nothing
  // embeds until S8, so a chunk lands with neither the vector nor the route that would have
  // made one — and a row may never carry one of the two without the other.
  embedding: embeddingVector("embedding"),
  embeddingRouteId: text("embedding_route_id"),
  // The three visibility columns every readable unit carries (ADR 0023) — the audience as
  // its word and its group-id array (ADR 0039), tied by the CHECK the hand-written DDL
  // copies from `AUDIENCE_CHECK`.
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  sensitivity: text("sensitivity").notNull(),
  audience: text("audience").notNull(),
  audienceGroups: text("audience_groups").array(),
  // On every chunk row: a chunk is always source-derived (ADR 0023 puts `binding_id`
  // on source-derived rows; canonical entities, which carry none, have no chunks).
  bindingId: text("binding_id").notNull(),
  // The document this is a unit of, and the chunk's own locator — a span,
  // `chars:<start>-<end>` in Unicode code points into that document's normalised redacted
  // text (`CONTEXT.md`, *locator*). The migration keys the pair to `source_document` and
  // cascades a document's deletion through it, and holds one row per document and locator.
  sourceDocumentId: text("source_document_id"),
  locator: text("locator"),
  // The splitter's position, so a passage read never parses a locator it already has the row
  // for, and the same span as two numbers, so a locator's range resolves to its covering rows
  // by two comparisons.
  ordinal: integer("ordinal"),
  charStart: integer("char_start"),
  charEnd: integer("char_end"),
  // The database's own work and neither tier's: one right value, decided by the content.
  search: searchVector("search")
    .notNull()
    .generatedAlwaysAs(sql`to_tsvector('english', content)`),
});
