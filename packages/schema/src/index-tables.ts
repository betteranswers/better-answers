import { sql } from "drizzle-orm";
import { customType, integer, pgSchema, text } from "drizzle-orm/pg-core";
import { z } from "zod";

export const indexSchema = pgSchema("index");

export const EMBEDDING_DIMENSIONS = 1024;

// pgvector's text output is a JSON number array by the column's own contract, read as one.
const embeddingValues = z.array(z.number());

const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${EMBEDDING_DIMENSIONS})`,
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => embeddingValues.parse(JSON.parse(value)),
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
