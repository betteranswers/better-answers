import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import { ingressCounter, mcpCallCounter } from "./counter-tables.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import {
  account,
  invitation,
  jwks,
  member,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  rateLimit,
  session,
  user,
  verification,
} from "./identity-tables.ts";
import { chunk, EMBEDDING_DIMENSIONS } from "./index-tables.ts";
import { ROLES } from "./roles.ts";
import { llmRoute, workspaceConfig } from "./schema.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The boundary schemas (ADR 0028): generated from the tables, refined only to narrow,
 * every refinement a callback in the generating call's second argument — except
 * `chunk.embedding`, the documented `customType` exception, whose refinement is a
 * plain schema because a callback on a custom column throws at module evaluation.
 * The registry is what the five parity assertions walk; the **schemas here, not the
 * tables, are the source of application-level types** (the brand survives `z.infer`).
 *
 * The identity set's tables (ADR 0009, 2026-09-01) are written by Better Auth alone,
 * so their boundaries are the unrefined generation — the table's own shape — except
 * where the platform reads a column and narrows it: `member.role` to the three roles,
 * the user and workspace ids to the platform's brands.
 */

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const workspaceId = (schema: z.ZodString) => schema.regex(ULID).brand<"WorkspaceId">();
const userId = (schema: z.ZodString) => schema.trim().min(1).brand<"UserId">();

/** The unrefined generation, for a table whose shape is its boundary. */
const plain = <TTable extends PgTable>(table: TTable) =>
  ({
    table,
    select: createSelectSchema(table),
    insert: createInsertSchema(table),
    update: createUpdateSchema(table),
  }) as const;

const workspaceRefinements = {
  id: workspaceId,
  name: (schema: z.ZodString) => schema.trim().min(1),
  slug: (schema: z.ZodString) => schema.trim().min(1),
};

export const workspaceSelect = createSelectSchema(workspace, workspaceRefinements);
export const workspaceInsert = createInsertSchema(workspace, workspaceRefinements);
export const workspaceUpdate = createUpdateSchema(workspace, workspaceRefinements);

const llmRouteRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId,
  provider: (schema: z.ZodString) => schema.trim().min(1),
  model: (schema: z.ZodString) => schema.trim().min(1),
  dimensions: (schema: z.ZodNumber) => schema.int().positive(),
};

export const llmRouteSelect = createSelectSchema(llmRoute, llmRouteRefinements);
export const llmRouteInsert = createInsertSchema(llmRoute, llmRouteRefinements);
export const llmRouteUpdate = createUpdateSchema(llmRoute, llmRouteRefinements);

const workspaceConfigRefinements = {
  workspaceId,
  key: (schema: z.ZodString) => schema.trim().min(1),
};

export const workspaceConfigSelect = createSelectSchema(workspaceConfig, workspaceConfigRefinements);
export const workspaceConfigInsert = createInsertSchema(workspaceConfig, workspaceConfigRefinements);
export const workspaceConfigUpdate = createUpdateSchema(workspaceConfig, workspaceConfigRefinements);

const chunkRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId,
  // The customType exception: a plain schema, never a callback (ADR 0028). The
  // length narrows to what the column's vector(N) accepts.
  embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS),
  embeddingRouteId: (schema: z.ZodString) => schema.trim().min(1),
  // The glossary's closed set (CONTEXT.md, *sensitivity*); the column stays text so
  // the set is the boundary's to narrow, exactly as ADR 0028 intends.
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(["Restricted", "Internal", "Public"])),
  // *audience* is "everyone in the workspace, or named groups" — not a closed word
  // set, so the boundary narrows to non-empty only.
  audience: (schema: z.ZodString) => schema.trim().min(1),
  bindingId: (schema: z.ZodString) => schema.trim().min(1),
};

export const chunkSelect = createSelectSchema(chunk, chunkRefinements);
export const chunkInsert = createInsertSchema(chunk, chunkRefinements);
// A plain schema replaces the generated field wholesale — the update generation's
// `.optional()` included — so the update form carries its own optional copy;
// without it an update would demand an embedding.
export const chunkUpdate = createUpdateSchema(chunk, {
  ...chunkRefinements,
  embedding: chunkRefinements.embedding.optional(),
});

const userRefinements = {
  id: userId,
  email: (schema: z.ZodString) => schema.trim().min(1),
};

export const userSelect = createSelectSchema(user, userRefinements);
export const userInsert = createInsertSchema(user, userRefinements);
export const userUpdate = createUpdateSchema(user, userRefinements);

const memberRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId,
  userId,
  // The platform's three roles and no other (CONTEXT.md, *role (of a person)*).
  role: (schema: z.ZodString) => schema.pipe(z.enum(ROLES)),
};

export const memberSelect = createSelectSchema(member, memberRefinements);
export const memberInsert = createInsertSchema(member, memberRefinements);
export const memberUpdate = createUpdateSchema(member, memberRefinements);

const mcpCallCounterRefinements = {
  workspaceId,
  tokenId: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

export const mcpCallCounterSelect = createSelectSchema(mcpCallCounter, mcpCallCounterRefinements);
export const mcpCallCounterInsert = createInsertSchema(mcpCallCounter, mcpCallCounterRefinements);
export const mcpCallCounterUpdate = createUpdateSchema(mcpCallCounter, mcpCallCounterRefinements);

const ingressCounterRefinements = {
  scope: (schema: z.ZodString) => schema.pipe(z.enum(["ip", "email"])),
  key: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

export const ingressCounterSelect = createSelectSchema(ingressCounter, ingressCounterRefinements);
export const ingressCounterInsert = createInsertSchema(ingressCounter, ingressCounterRefinements);
export const ingressCounterUpdate = createUpdateSchema(ingressCounter, ingressCounterRefinements);

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
  workspaceConfig: {
    table: workspaceConfig,
    select: workspaceConfigSelect,
    insert: workspaceConfigInsert,
    update: workspaceConfigUpdate,
  },
  chunk: { table: chunk, select: chunkSelect, insert: chunkInsert, update: chunkUpdate },
  user: { table: user, select: userSelect, insert: userInsert, update: userUpdate },
  member: { table: member, select: memberSelect, insert: memberInsert, update: memberUpdate },
  mcpCallCounter: {
    table: mcpCallCounter,
    select: mcpCallCounterSelect,
    insert: mcpCallCounterInsert,
    update: mcpCallCounterUpdate,
  },
  ingressCounter: {
    table: ingressCounter,
    select: ingressCounterSelect,
    insert: ingressCounterInsert,
    update: ingressCounterUpdate,
  },
  session: plain(session),
  account: plain(account),
  verification: plain(verification),
  jwks: plain(jwks),
  invitation: plain(invitation),
  oauthClient: plain(oauthClient),
  oauthResource: plain(oauthResource),
  oauthClientResource: plain(oauthClientResource),
  oauthRefreshToken: plain(oauthRefreshToken),
  oauthAccessToken: plain(oauthAccessToken),
  oauthConsent: plain(oauthConsent),
  oauthClientAssertion: plain(oauthClientAssertion),
  rateLimit: plain(rateLimit),
} as const;
