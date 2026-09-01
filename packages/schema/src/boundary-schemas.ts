import { z } from "zod";

import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { chunk } from "./index-tables.ts";
import { llmRoute, workspace } from "./schema.ts";

/**
 * The boundary schemas (ADR 0028): generated from the tables, refined only to narrow,
 * every refinement a callback in the generating call's second argument — except
 * `chunk.embedding`, the documented `customType` exception, whose refinement is a
 * plain schema because a callback on a custom column throws at module evaluation.
 * The registry is what the five parity assertions walk; the **schemas here, not the
 * tables, are the source of application-level types** (the brand survives `z.infer`).
 */

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const workspaceRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID).brand<"WorkspaceId">(),
  name: (schema: z.ZodString) => schema.trim().min(1),
};

export const workspaceSelect = createSelectSchema(workspace, workspaceRefinements);
export const workspaceInsert = createInsertSchema(workspace, workspaceRefinements);
export const workspaceUpdate = createUpdateSchema(workspace, workspaceRefinements);

const llmRouteRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId: (schema: z.ZodString) => schema.regex(ULID).brand<"WorkspaceId">(),
  provider: (schema: z.ZodString) => schema.trim().min(1),
  model: (schema: z.ZodString) => schema.trim().min(1),
  dimensions: (schema: z.ZodNumber) => schema.int().positive(),
};

export const llmRouteSelect = createSelectSchema(llmRoute, llmRouteRefinements);
export const llmRouteInsert = createInsertSchema(llmRoute, llmRouteRefinements);
export const llmRouteUpdate = createUpdateSchema(llmRoute, llmRouteRefinements);

const chunkRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId: (schema: z.ZodString) => schema.regex(ULID).brand<"WorkspaceId">(),
  // The customType exception: a plain schema, never a callback (ADR 0028). Length
  // 1024 narrows to what the column's vector(1024) accepts.
  embedding: z.array(z.number()).length(1024),
  embeddingRouteId: (schema: z.ZodString) => schema.trim().min(1),
  bindingId: (schema: z.ZodString) => schema.trim().min(1),
};

export const chunkSelect = createSelectSchema(chunk, chunkRefinements);
export const chunkInsert = createInsertSchema(chunk, chunkRefinements);
export const chunkUpdate = createUpdateSchema(chunk, chunkRefinements);

/** One entry per table this package owns — the parity test's registry (ADR 0028). */
export const boundarySchemas = {
  workspace: {
    table: workspace,
    select: workspaceSelect,
    insert: workspaceInsert,
    update: workspaceUpdate,
  },
  llmRoute: {
    table: llmRoute,
    select: llmRouteSelect,
    insert: llmRouteInsert,
    update: llmRouteUpdate,
  },
  chunk: { table: chunk, select: chunkSelect, insert: chunkInsert, update: chunkUpdate },
} as const;
