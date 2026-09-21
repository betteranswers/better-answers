import { sql } from "drizzle-orm";
import { customType, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const indexSchema = pgSchema("index");

export const EMBEDDING_DIMENSIONS = 1024;

const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${EMBEDDING_DIMENSIONS})`,
  toDriver: (value) => JSON.stringify(value),

  // SAFETY: pgvector's text output is a JSON-compatible number array, so the parse yields
  // numbers by the column's own contract.
  fromDriver: (value) => JSON.parse(value) as number[],
});

const searchVector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

export const chunk = indexSchema.table("chunk", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  content: text("content").notNull(),

  embedding: embeddingVector("embedding"),
  embeddingRouteId: text("embedding_route_id"),

  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  sensitivity: text("sensitivity").notNull(),
  audience: text("audience").notNull(),
  audienceGroups: text("audience_groups").array(),

  bindingId: text("binding_id").notNull(),

  sourceDocumentId: text("source_document_id"),
  locator: text("locator"),

  ordinal: integer("ordinal"),
  charStart: integer("char_start"),
  charEnd: integer("char_end"),

  search: searchVector("search")
    .notNull()
    .generatedAlwaysAs(sql`to_tsvector('english', content)`),
});
