import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import { ACT_PATTERN, auditEvent, FAMILIES } from "./audit-tables.ts";
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
import { ULID, ULID_CHARACTERS } from "./ulid.ts";
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
 * the user and workspace ids to the platform's brands, and the ids of `user`, `session`,
 * `member` and `invitation` to the one shape the minter mints (ADR 0035, T-074). The
 * OAuth tables stay unrefined: the library keys one of them by a hash of the token the
 * row stands for, so their ids are not the platform's to narrow.
 */

const workspaceId = (schema: z.ZodString) => schema.regex(ULID).brand<"WorkspaceId">();
const userId = (schema: z.ZodString) => schema.regex(ULID).brand<"UserId">();
/**
 * An id of the identity set the platform reads or writes: one shape, the minter's
 * (`ulid.ts`, ADR 0035). The OAuth tables are deliberately left unnarrowed — the library
 * keys one of them by a hash of the token it stands for, which is not a minted id.
 */
const identityId = (schema: z.ZodString) => schema.regex(ULID);

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

export const workspaceConfigSelect = createSelectSchema(
  workspaceConfig,
  workspaceConfigRefinements,
);
export const workspaceConfigInsert = createInsertSchema(
  workspaceConfig,
  workspaceConfigRefinements,
);
export const workspaceConfigUpdate = createUpdateSchema(
  workspaceConfig,
  workspaceConfigRefinements,
);

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
  id: identityId,
  workspaceId,
  userId,
  // The platform's three roles and no other (CONTEXT.md, *role (of a person)*).
  role: (schema: z.ZodString) => schema.pipe(z.enum(ROLES)),
};

export const memberSelect = createSelectSchema(member, memberRefinements);
export const memberInsert = createInsertSchema(member, memberRefinements);
export const memberUpdate = createUpdateSchema(member, memberRefinements);

const sessionRefinements = { id: identityId };

export const sessionSelect = createSelectSchema(session, sessionRefinements);
export const sessionInsert = createInsertSchema(session, sessionRefinements);
export const sessionUpdate = createUpdateSchema(session, sessionRefinements);

const invitationRefinements = { id: identityId };

export const invitationSelect = createSelectSchema(invitation, invitationRefinements);
export const invitationInsert = createInsertSchema(invitation, invitationRefinements);
export const invitationUpdate = createUpdateSchema(invitation, invitationRefinements);

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

/**
 * The ledger's actor, narrowed to the three forms the kernel's `ActorId` names (ADR 0035):
 * a person by their person id — the minter's shape, so an email cannot pass for one — the
 * platform by `process:better-answers-<purpose>`, an agent by `better-answers-<purpose>/<version>`
 * as ADR 0019 shapes it.
 */
const ACTOR_ID = new RegExp(
  `^(human:${ULID_CHARACTERS}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$`,
);
const ACT = new RegExp(ACT_PATTERN);

/**
 * The detail a row carries: ids and role words, and an act's confirmations as typed
 * fields — one flat object of scalars. What each declared act's detail names is the audit
 * slice's business; the boundary holds the container to a shape an email or a prompt has
 * no nested place to hide in. JSON `null` stays accepted because the column accepts it —
 * `jsonb NOT NULL` refuses SQL NULL, not the JSON value — and the parity suite holds a
 * refinement to the column's own nullability; the audit slice's doors never write one.
 */
const detail = z.union([
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  z.null(),
]);

const auditEventRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID).brand<"AuditEventId">(),
  workspaceId,
  act: (schema: z.ZodString) =>
    schema.regex(ACT).pipe(z.templateLiteral([z.enum(FAMILIES), ".", z.string(), ".", z.string()])),
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID),
  subjectId: (schema: z.ZodString) => schema.trim().min(1),
  detail: (schema: z.ZodType) => schema.pipe(detail),
  batchId: (schema: z.ZodString) => schema.regex(ULID),
};

// `family` and `subject_kind` are generated columns: drizzle-zod leaves them out of the
// insert and update forms, so their narrowing belongs to the select form alone.
export const auditEventSelect = createSelectSchema(auditEvent, {
  ...auditEventRefinements,
  family: (schema: z.ZodString) => schema.pipe(z.enum(FAMILIES)),
  subjectKind: (schema: z.ZodString) => schema.trim().min(1),
});
export const auditEventInsert = createInsertSchema(auditEvent, auditEventRefinements);
export const auditEventUpdate = createUpdateSchema(auditEvent, auditEventRefinements);

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
  auditEvent: {
    table: auditEvent,
    select: auditEventSelect,
    insert: auditEventInsert,
    update: auditEventUpdate,
  },
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
  session: {
    table: session,
    select: sessionSelect,
    insert: sessionInsert,
    update: sessionUpdate,
  },
  account: plain(account),
  verification: plain(verification),
  jwks: plain(jwks),
  invitation: {
    table: invitation,
    select: invitationSelect,
    insert: invitationInsert,
    update: invitationUpdate,
  },
  oauthClient: plain(oauthClient),
  oauthResource: plain(oauthResource),
  oauthClientResource: plain(oauthClientResource),
  oauthRefreshToken: plain(oauthRefreshToken),
  oauthAccessToken: plain(oauthAccessToken),
  oauthConsent: plain(oauthConsent),
  oauthClientAssertion: plain(oauthClientAssertion),
  rateLimit: plain(rateLimit),
} as const;
