import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  accessRequest,
  ACCESS_REQUEST_REASON_MAX,
  ACCESS_REQUEST_STATUSES,
} from "./access-request-tables.ts";
import { ACT, auditEvent, FAMILIES } from "./audit-tables.ts";
import {
  bundleCommit,
  CONCEPT_STATUSES,
  conceptIdentity,
  conceptIndex,
  conceptVerification,
  CONTENT_HASH,
  evidence,
  GIT_SHA,
  IRI,
  SENSITIVITIES,
  VERIFICATION_ORIGINS,
} from "./concept-tables.ts";
import { ingressCounter, mcpCallCounter } from "./counter-tables.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { group, GROUP_ORIGINS, groupMember } from "./group-tables.ts";
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
 * A group's id, on the group row and on every membership that names it: platform-minted,
 * so T-006's `audience_groups` refinement can assume the shape (ADR 0038). The brand is
 * where the kernel's `GroupId` comes from, as `WorkspaceId` and `UserId` do.
 */
const groupId = (schema: z.ZodString) => schema.regex(ULID).brand<"GroupId">();
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
  // the set is the boundary's to narrow, exactly as ADR 0028 intends. The list is the
  // one `concept_index` narrows to as well — a readable unit's classes are one fact.
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
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

const groupRefinements = {
  id: groupId,
  workspaceId,
  name: (schema: z.ZodString) => schema.trim().min(1),
  // The closed pair (ADR 0038); the column stays text so the set is the boundary's to
  // narrow, exactly as `chunk.sensitivity` is.
  origin: (schema: z.ZodString) => schema.pipe(z.enum(GROUP_ORIGINS)),
};

export const groupSelect = createSelectSchema(group, groupRefinements);
export const groupInsert = createInsertSchema(group, groupRefinements);
export const groupUpdate = createUpdateSchema(group, groupRefinements);

// Keyed by workspace, group and person, and carrying nothing else about the person: a
// membership says who may see what, never what they may do (ADR 0038).
const groupMemberRefinements = { workspaceId, groupId, userId };

export const groupMemberSelect = createSelectSchema(groupMember, groupMemberRefinements);
export const groupMemberInsert = createInsertSchema(groupMember, groupMemberRefinements);
export const groupMemberUpdate = createUpdateSchema(groupMember, groupMemberRefinements);

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
export const ACTOR_ID = new RegExp(
  `^(human:${ULID_CHARACTERS}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$`,
);

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

/**
 * The *access request* (ADR 0038): the requester and the decider are person ids, the
 * invitation the minter's shape, the status the closed set, and the reason a sentence of
 * why — non-empty and bounded, because the surface that writes one is open to any signed-in
 * person and an unbounded field would be storage a stranger chooses the size of.
 */
const accessRequestRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID).brand<"AccessRequestId">(),
  workspaceId,
  requesterId: userId,
  reason: (schema: z.ZodString) => schema.trim().min(1).max(ACCESS_REQUEST_REASON_MAX),
  status: (schema: z.ZodString) => schema.pipe(z.enum(ACCESS_REQUEST_STATUSES)),
  decidedBy: userId,
  invitationId: identityId,
};

export const accessRequestSelect = createSelectSchema(accessRequest, accessRequestRefinements);
export const accessRequestInsert = createInsertSchema(accessRequest, accessRequestRefinements);
export const accessRequestUpdate = createUpdateSchema(accessRequest, accessRequestRefinements);

/**
 * A concept's IRI (ADR 0002): the platform-minted key every record about a concept attaches
 * by, branded so a path or a title cannot be passed where one belongs. The brand is where
 * the kernel's `ConceptIri` comes from, as `WorkspaceId` and `GroupId` are.
 */
const conceptIri = (schema: z.ZodString) => schema.regex(IRI).brand<"ConceptIri">();

/**
 * A concept's frontmatter as the row holds it: OKF's flat keys — scalars and string lists —
 * and nothing nested, so the file's shape survives the round trip and a value with somewhere
 * to hide does not. JSON `null` stays accepted for the container because the column accepts
 * it (`jsonb NOT NULL` refuses SQL NULL, not the JSON value) and the parity suite holds the
 * refinement to the column's own nullability; the write path never stores one.
 */
const frontmatter = z.union([
  z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
  ),
  z.null(),
]);

const conceptIdentityRefinements = {
  workspaceId,
  iri: conceptIri,
  mergeKey: (schema: z.ZodString) => schema.trim().min(1),
};

export const conceptIdentitySelect = createSelectSchema(
  conceptIdentity,
  conceptIdentityRefinements,
);
export const conceptIdentityInsert = createInsertSchema(
  conceptIdentity,
  conceptIdentityRefinements,
);
export const conceptIdentityUpdate = createUpdateSchema(
  conceptIdentity,
  conceptIdentityRefinements,
);

/**
 * The concept index (ADR 0012): the derived row per concept. The two hashes are narrowed to
 * their own shapes — a git object name and the canonical-form SHA-256 — so a row can never
 * hold one where the other belongs, and the three visibility columns are narrowed exactly as
 * `index.chunk`'s are, because the read predicate is tested against them (ADR 0023).
 */
const conceptIndexRefinements = {
  workspaceId,
  iri: conceptIri,
  path: (schema: z.ZodString) => schema.trim().min(1),
  kind: (schema: z.ZodString) => schema.trim().min(1),
  title: (schema: z.ZodString) => schema.trim().min(1),
  frontmatter: (schema: z.ZodType) => schema.pipe(frontmatter),
  contentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
  commitSha: (schema: z.ZodString) => schema.regex(GIT_SHA),
  status: (schema: z.ZodString) => schema.pipe(z.enum(CONCEPT_STATUSES)),
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
  audience: (schema: z.ZodString) => schema.trim().min(1),
};

export const conceptIndexSelect = createSelectSchema(conceptIndex, conceptIndexRefinements);
export const conceptIndexInsert = createInsertSchema(conceptIndex, conceptIndexRefinements);
export const conceptIndexUpdate = createUpdateSchema(conceptIndex, conceptIndexRefinements);

/**
 * A bundle commit (ADR 0012): the sha and its parent are git object names, the audit event
 * id is the minter's shape — the id the act minted before the commit and the commit carries
 * in its `Audit:` trailer — and the actor is the ledger's own actor shape, so the trailer and
 * the row cannot say different things about who acted.
 */
const bundleCommitRefinements = {
  workspaceId,
  sha: (schema: z.ZodString) => schema.regex(GIT_SHA),
  parentSha: (schema: z.ZodString) => schema.regex(GIT_SHA),
  auditEventId: (schema: z.ZodString) => schema.regex(ULID),
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID),
};

export const bundleCommitSelect = createSelectSchema(bundleCommit, bundleCommitRefinements);
export const bundleCommitInsert = createInsertSchema(bundleCommit, bundleCommitRefinements);
export const bundleCommitUpdate = createUpdateSchema(bundleCommit, bundleCommitRefinements);

const evidenceRefinements = {
  workspaceId,
  sourceDocumentId: (schema: z.ZodString) => schema.trim().min(1),
  locator: (schema: z.ZodString) => schema.trim().min(1),
  resource: (schema: z.ZodString) => schema.trim().min(1),
  contentVersion: (schema: z.ZodString) => schema.trim().min(1),
};

export const evidenceSelect = createSelectSchema(evidence, evidenceRefinements);
export const evidenceInsert = createInsertSchema(evidence, evidenceRefinements);
export const evidenceUpdate = createUpdateSchema(evidence, evidenceRefinements);

const conceptVerificationRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID),
  workspaceId,
  iri: conceptIri,
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID),
  contentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
  origin: (schema: z.ZodString) => schema.pipe(z.enum(VERIFICATION_ORIGINS)),
};

export const conceptVerificationSelect = createSelectSchema(
  conceptVerification,
  conceptVerificationRefinements,
);
export const conceptVerificationInsert = createInsertSchema(
  conceptVerification,
  conceptVerificationRefinements,
);
export const conceptVerificationUpdate = createUpdateSchema(
  conceptVerification,
  conceptVerificationRefinements,
);

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
  group: { table: group, select: groupSelect, insert: groupInsert, update: groupUpdate },
  groupMember: {
    table: groupMember,
    select: groupMemberSelect,
    insert: groupMemberInsert,
    update: groupMemberUpdate,
  },
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
  accessRequest: {
    table: accessRequest,
    select: accessRequestSelect,
    insert: accessRequestInsert,
    update: accessRequestUpdate,
  },
  conceptIdentity: {
    table: conceptIdentity,
    select: conceptIdentitySelect,
    insert: conceptIdentityInsert,
    update: conceptIdentityUpdate,
  },
  conceptIndex: {
    table: conceptIndex,
    select: conceptIndexSelect,
    insert: conceptIndexInsert,
    update: conceptIndexUpdate,
  },
  bundleCommit: {
    table: bundleCommit,
    select: bundleCommitSelect,
    insert: bundleCommitInsert,
    update: bundleCommitUpdate,
  },
  evidence: {
    table: evidence,
    select: evidenceSelect,
    insert: evidenceInsert,
    update: evidenceUpdate,
  },
  conceptVerification: {
    table: conceptVerification,
    select: conceptVerificationSelect,
    insert: conceptVerificationInsert,
    update: conceptVerificationUpdate,
  },
} as const;
