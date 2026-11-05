import { sql } from "drizzle-orm";
import { customType, integer, pgSchema, text } from "drizzle-orm/pg-core";
import { z } from "zod";

import { FULL_TEXT_LANGUAGE, searchVector } from "../knowledge/full-text-match.ts";

export const indexSchema = pgSchema("index");

export const EMBEDDING_DIMENSIONS = 1024;

/** pgvector prints a vector as a JSON number array, so the column is parsed as JSON. */
const embeddingValues = z.array(z.number());

const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${EMBEDDING_DIMENSIONS})`,
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => embeddingValues.parse(JSON.parse(value)),
});

export const passage = indexSchema.table("passage", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  content: text("content").notNull(),

  embedding: embeddingVector("embedding"),
  embeddingModelChoiceId: text("embedding_model_choice_id"),

  connectedSourceId: text("connected_source_id").notNull(),

  sourceDocumentId: text("source_document_id"),
  locator: text("locator"),

  ordinal: integer("ordinal"),
  charStart: integer("char_start"),
  charEnd: integer("char_end"),

  search: searchVector("search")
    .notNull()
    .generatedAlwaysAs(sql.raw(`to_tsvector(${FULL_TEXT_LANGUAGE}, content)`)),
});
