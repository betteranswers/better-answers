import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  accessRequest,
  ACCESS_REQUEST_REASON_MAX,
  ACCESS_REQUEST_STATUSES,
} from "./access-request-tables.ts";
import { ACTOR_ID as ACTOR_ID_REGEX } from "./actor-id.ts";
import { ACT, auditEvent, FAMILIES } from "./audit-tables.ts";
import { composition, compositionInclude } from "./composition-tables.ts";
import {
  AUDIENCES,
  bundleCommit,
  CONCEPT_FRONTMATTER_MAX,
  CONCEPT_PATH,
  CONCEPT_STATUSES,
  conceptClassOverride,
  conceptEvidence,
  conceptIdentity,
  conceptIndex,
  citedSourceOf,
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
import {
  GRAPH_EDGE_LABELS,
  GRAPH_NODE_LABELS,
  graphEdge,
  graphGeneration,
  graphNode,
  SOURCE_ENTITY_LABEL_PREFIX,
} from "./graph-tables.ts";
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
import { sourceBinding, sourceDocument } from "./source-tables.ts";
import {
  conceptWriteRequest,
  suggestion,
  SUGGESTION_BODY_MAX,
  SUGGESTION_KINDS,
  SUGGESTION_REASON_MAX,
  SUGGESTION_STATUSES,
} from "./suggestion-tables.ts";
import { ULID } from "./ulid.ts";
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
/** A source binding's id — the minter's shape, as a document's `binding_id` names one (ADR 0013). */
const bindingId = (schema: z.ZodString) => schema.regex(ULID).brand<"BindingId">();
/** A composition's id — the minter's shape, as an include's `composition_id` names one. */
const compositionId = (schema: z.ZodString) => schema.regex(ULID).brand<"CompositionId">();
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

/**
 * The three visibility columns every readable unit narrows alike, so its classes are one
 * fact across `index.chunk`, `concept_index`, `composition`, the graph rows and the binding
 * they derive from (ADR 0023, ADR 0039): *sensitivity* to the glossary's closed set — the
 * column stays text so the set is the boundary's to narrow, exactly as ADR 0028 intends —
 * *audience* to the closed pair, and *audience_groups* to platform-minted group ids, at
 * least one when the array is there at all.
 *
 * The tie between the word and the array — *everyone* over no array, *groups* over a
 * non-empty one — is the row's own CHECK (`AUDIENCE_CHECK`) and deliberately not a second
 * refinement over the object: the governed write parses the index row's insert schema with
 * the commit's sha omitted, and zod refuses `.omit()` over an object that carries a
 * refinement. One rule in one place, proved against the row in `test/rls.test.ts`, beats two
 * that could disagree.
 */
const readableUnit = {
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
  audience: (schema: z.ZodString) => schema.pipe(z.enum(AUDIENCES)),
  audienceGroups: (schema: z.ZodArray<z.ZodString>) => z.array(groupId(schema.element)).min(1),
};

const chunkRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId,
  // The customType exception: a plain schema, never a callback (ADR 0028). The
  // length narrows to what the column's vector(N) accepts.
  embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS),
  embeddingRouteId: (schema: z.ZodString) => schema.trim().min(1),
  ...readableUnit,
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
 * The ledger's actor, narrowed to the three forms the kernel's `ActorId` names — the one
 * pattern `actor-id.ts` writes, so a refinement here and a CHECK on a row are held to the
 * same characters. Re-exported, because the package's callers have always read it here.
 */
export { ACTOR_ID } from "./actor-id.ts";

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
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
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
 * A concept's frontmatter as the row holds it: OKF's scalars and string lists, plus the one
 * shape the spec defines as a list of objects — **`sources[]`**, whose entries carry
 * `resource` (required), `id`, `title`, `author`, `usage_count` and `last_modified`, and the
 * platform's `locator` beside them (`docs/okf-v02.md`). One level of nesting and no more, so
 * the file's shape survives the round trip and a value with somewhere to hide does not.
 *
 * JSON `null` stays accepted for the container because the column accepts it (`jsonb NOT
 * NULL` refuses SQL NULL, not the JSON value) and the parity suite holds the refinement to
 * the column's own nullability; the write path never stores one.
 */
/** One list-of-objects entry: a flat object of scalars, whatever key it sits under. */
const frontmatterEntry = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/**
 * Whether one `sources[]` entry names the resource it cites — **asked of the one reader**
 * (`citedSourceOf`), never of a second copy of its rules. OKF requires `resource` and the hash
 * reduces every entry to a `(resource, locator)` pair (ADR 0019), so what this refuses and
 * what the hash reduces are the same judgement by construction: an entry the reader cannot
 * read is an entry with nothing to cite.
 */
const namesAResource = (entry: z.infer<typeof frontmatterEntry> | string): boolean =>
  citedSourceOf(entry) !== undefined;

/**
 * The one shape a concept's frontmatter has, **exported** — because the row is not the only
 * place it appears: `open` serves it on the MCP surface, whose output schema has to accept
 * exactly what the row can hold. Two copies of this union would be a wire that refuses a
 * concept the database accepted, which is how the api's typecheck found the second copy.
 *
 * **The resource requirement is `sources`' alone.** Every other key is preserved verbatim
 * (ADR 0019), unknown keys and their nested values included, so a concept that carries some
 * other list of objects — a vendor's, a future spec's — is a concept this refuses to lose.
 * The requirement is a refinement over the whole record rather than over the entry type,
 * because the entry type has no idea which key it sits under.
 */
export const conceptFrontmatter = z
  .record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.string()),
      z.array(frontmatterEntry),
    ]),
  )
  .superRefine((value, context) => {
    // The bound `submit_suggestion_set` also holds, **in the units it counts**. Frontmatter
    // is open — every key preserved verbatim (ADR 0019) — so nothing about its shape says
    // how large it may be, and a producer who chose that would be choosing how much the
    // platform stores. Counted by iteration rather than `.length`, because `.length` counts
    // UTF-16 code units and Postgres's `char_length` counts characters: an astral character
    // is two there and one here, and two numbers for one bound is the defect this pair had.
    let characters = 0;
    for (const _ of JSON.stringify(value)) characters += 1;
    if (characters > CONCEPT_FRONTMATTER_MAX) {
      context.addIssue({
        code: "custom",
        message: `a concept's frontmatter is at most ${CONCEPT_FRONTMATTER_MAX} characters of JSON`,
      });
    }
    const sources = value["sources"];
    if (!Array.isArray(sources)) return;
    for (const [index, entry] of sources.entries()) {
      if (namesAResource(entry)) continue;
      context.addIssue({
        code: "custom",
        path: ["sources", index],
        message: "a sources[] entry names the resource it cites",
      });
    }
  });

const frontmatter = z.union([conceptFrontmatter, z.null()]);

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
/**
 * A concept's file, wherever a row holds one: the derived index row, and the payload an
 * acceptance would commit. Narrowed once, so a payload the boundary accepts is a payload the
 * index row's boundary will accept too — otherwise a suggestion could be stored that nobody
 * could ever accept, and the refusal would land on the Admin deciding it.
 *
 * The path is a place in the bundle's concept area and nothing else: the manifest at the
 * bundle root is platform-reserved (ADR 0002), and a row pointing at it would be claiming a
 * file the format does not read as a concept.
 */
const conceptFileRefinements = {
  path: (schema: z.ZodString) => schema.regex(CONCEPT_PATH),
  title: (schema: z.ZodString) => schema.trim().min(1),
  frontmatter: (schema: z.ZodType) => schema.pipe(frontmatter),
};

/**
 * The OKF `type` a file carries, under whichever column name its table gives it: `kind` on
 * the index row, which is the folded word the type vocabulary counts, and `concept_kind` on
 * a payload, where the bare word would read as the *suggestion's* kind.
 */
const conceptKind = (schema: z.ZodString) => schema.trim().min(1);

const conceptIndexRefinements = {
  workspaceId,
  iri: conceptIri,
  ...conceptFileRefinements,
  kind: conceptKind,
  contentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
  commitSha: (schema: z.ZodString) => schema.regex(GIT_SHA),
  status: (schema: z.ZodString) => schema.pipe(z.enum(CONCEPT_STATUSES)),
  ...readableUnit,
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
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
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
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
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

/** A citation: the concept by IRI, the evidence by the key `evidence` itself carries. */
const conceptEvidenceRefinements = {
  workspaceId,
  iri: conceptIri,
  sourceDocumentId: (schema: z.ZodString) => schema.trim().min(1),
  locator: (schema: z.ZodString) => schema.trim().min(1),
};

export const conceptEvidenceSelect = createSelectSchema(
  conceptEvidence,
  conceptEvidenceRefinements,
);
export const conceptEvidenceInsert = createInsertSchema(
  conceptEvidence,
  conceptEvidenceRefinements,
);
export const conceptEvidenceUpdate = createUpdateSchema(
  conceptEvidence,
  conceptEvidenceRefinements,
);

/**
 * A recorded Admin override (ADR 0039): the class and audience narrowed as every readable
 * unit's are, the Admin in the ledger's actor form, and the ledger row's id in the minter's
 * shape — the row half of *an audit event and a row*.
 */
const conceptClassOverrideRefinements = {
  workspaceId,
  iri: conceptIri,
  ...readableUnit,
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  auditEventId: (schema: z.ZodString) => schema.regex(ULID),
};

export const conceptClassOverrideSelect = createSelectSchema(
  conceptClassOverride,
  conceptClassOverrideRefinements,
);
export const conceptClassOverrideInsert = createInsertSchema(
  conceptClassOverride,
  conceptClassOverrideRefinements,
);
export const conceptClassOverrideUpdate = createUpdateSchema(
  conceptClassOverride,
  conceptClassOverrideRefinements,
);

/**
 * A source binding as the derivation reads it (ADR 0013, ADR 0039): the three visibility
 * columns narrowed as every readable unit's are, its id the minter's shape.
 */
const sourceBindingRefinements = {
  workspaceId,
  id: bindingId,
  ...readableUnit,
};

export const sourceBindingSelect = createSelectSchema(sourceBinding, sourceBindingRefinements);
export const sourceBindingInsert = createInsertSchema(sourceBinding, sourceBindingRefinements);
export const sourceBindingUpdate = createUpdateSchema(sourceBinding, sourceBindingRefinements);

/**
 * A source document as the derivation reads it: its id is what `evidence` names, narrowed
 * exactly as `evidence.source_document_id` is, and its binding is the minter's shape.
 */
const sourceDocumentRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.trim().min(1),
  bindingId,
};

export const sourceDocumentSelect = createSelectSchema(sourceDocument, sourceDocumentRefinements);
export const sourceDocumentInsert = createInsertSchema(sourceDocument, sourceDocumentRefinements);
export const sourceDocumentUpdate = createUpdateSchema(sourceDocument, sourceDocumentRefinements);

/** A composition (ADR 0004, ADR 0015): a readable unit, its id the minter's shape. */
const compositionRefinements = {
  workspaceId,
  id: compositionId,
  ...readableUnit,
};

export const compositionSelect = createSelectSchema(composition, compositionRefinements);
export const compositionInsert = createInsertSchema(composition, compositionRefinements);
export const compositionUpdate = createUpdateSchema(composition, compositionRefinements);

/**
 * An include (ADR 0015): its id is the label a citation marker carries, non-empty; its place
 * a non-negative ordinal; the concept it names an IRI.
 */
const compositionIncludeRefinements = {
  workspaceId,
  compositionId,
  id: (schema: z.ZodString) => schema.trim().min(1),
  ordinal: (schema: z.ZodNumber) => schema.int().nonnegative(),
  iri: conceptIri,
};

export const compositionIncludeSelect = createSelectSchema(
  compositionInclude,
  compositionIncludeRefinements,
);
export const compositionIncludeInsert = createInsertSchema(
  compositionInclude,
  compositionIncludeRefinements,
);
export const compositionIncludeUpdate = createUpdateSchema(
  compositionInclude,
  compositionIncludeRefinements,
);

/**
 * A graph label: the partition's closed set, or the prefixed source-entity form (ADR 0032).
 * The prefix arm is the boundary's whole rule for a source-entity label until the lift that
 * writes them lands its closed set (B7); the tie between the label family and `gen` is the
 * insert schemas' own cross-field refinement below, mirroring each table's CHECK.
 */
const graphLabel = (labels: readonly string[]) => (schema: z.ZodString) =>
  schema.refine(
    (label) =>
      labels.some((known) => known === label) || label.startsWith(SOURCE_ENTITY_LABEL_PREFIX),
    { message: "a graph label is one of the closed set, or wears the source-entity prefix" },
  );

/**
 * The label family and the generation held together, as the tables' CHECKs hold them —
 * refused here so the invalid pair never reaches an INSERT. A prefixed source-entity label
 * carries no `gen` on either table; a closed **node** label is a bundle-and-record row and
 * must carry one; a closed **edge** label is admitted in either partition, because the
 * source-entity partition's own edges wear closed labels (`IS_CONCEPT`, `SAME_AS` — ADR
 * 0026's amendment).
 */
type GraphRowInput = { readonly label: string; readonly gen?: number | null };

const sourceEntityCarriesNoGen = (row: GraphRowInput): boolean =>
  !row.label.startsWith(SOURCE_ENTITY_LABEL_PREFIX) || row.gen === null || row.gen === undefined;

const closedNodeLabelCarriesGen = (row: GraphRowInput): boolean =>
  row.label.startsWith(SOURCE_ENTITY_LABEL_PREFIX) || (row.gen !== null && row.gen !== undefined);

/** A generation: the rebuild counter's value, from 1 — `gen` and `live_gen` alike. */
const generation = (schema: z.ZodNumber) => schema.int().positive();

const graphGenerationRefinements = {
  workspaceId,
  liveGen: generation,
};

export const graphGenerationSelect = createSelectSchema(
  graphGeneration,
  graphGenerationRefinements,
);
export const graphGenerationInsert = createInsertSchema(
  graphGeneration,
  graphGenerationRefinements,
);
export const graphGenerationUpdate = createUpdateSchema(
  graphGeneration,
  graphGenerationRefinements,
);

/** A graph row's text — a uid, a kind: non-empty, because an empty one names nothing. */
const graphKey = (schema: z.ZodString) => schema.trim().min(1);

/**
 * The graph rows (ADR 0032): what a node and an edge narrow alike — the label's rule is
 * per table, the visibility columns exactly `concept_index`'s, because the read predicate
 * is tested against them.
 */
const graphRow = {
  workspaceId,
  gen: generation,
  uid: graphKey,
  ...readableUnit,
};

const graphNodeRefinements = {
  ...graphRow,
  label: graphLabel(GRAPH_NODE_LABELS),
  kind: graphKey,
};

export const graphNodeSelect = createSelectSchema(graphNode, graphNodeRefinements);
export const graphNodeInsert = createInsertSchema(graphNode, graphNodeRefinements)
  .refine(sourceEntityCarriesNoGen, {
    message: "a source-entity label carries no generation",
    path: ["gen"],
  })
  .refine(closedNodeLabelCarriesGen, {
    message: "a closed node label is a bundle-and-record row and carries its generation",
    path: ["gen"],
  });
export const graphNodeUpdate = createUpdateSchema(graphNode, graphNodeRefinements);

const graphEdgeRefinements = {
  ...graphRow,
  label: graphLabel(GRAPH_EDGE_LABELS),
  fromUid: graphKey,
  toUid: graphKey,
  fromKind: graphKey,
  toKind: graphKey,
};

export const graphEdgeSelect = createSelectSchema(graphEdge, graphEdgeRefinements);
export const graphEdgeInsert = createInsertSchema(graphEdge, graphEdgeRefinements).refine(
  sourceEntityCarriesNoGen,
  { message: "a source-entity label carries no generation", path: ["gen"] },
);
export const graphEdgeUpdate = createUpdateSchema(graphEdge, graphEdgeRefinements);

/**
 * A **suggestion** (ADR 0012): the two actors are the ledger's own actor shape, so a
 * proposer and a decider read the same way wherever they appear; the target is a concept
 * IRI, because a resolved target is a concept and never a path; and the reason is bounded,
 * since the surface that writes one is open to any member of the workspace.
 */
const suggestionRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  setId: (schema: z.ZodString) => schema.regex(ULID),
  kind: (schema: z.ZodString) => schema.pipe(z.enum(SUGGESTION_KINDS)),
  status: (schema: z.ZodString) => schema.pipe(z.enum(SUGGESTION_STATUSES)),
  proposer: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  targetIri: conceptIri,
  decider: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  reason: (schema: z.ZodString) => schema.trim().min(1).max(SUGGESTION_REASON_MAX),
};

export const suggestionSelect = createSelectSchema(suggestion, suggestionRefinements);
export const suggestionInsert = createInsertSchema(suggestion, suggestionRefinements);
export const suggestionUpdate = createUpdateSchema(suggestion, suggestionRefinements);

/**
 * A **concept write request** — a suggestion's payload: the file above, plus what it means
 * it for and what it was written against. There is deliberately **no IRI**: identity is the
 * acceptance's to resolve from the merge key (ADR 0012).
 */
const conceptWriteRequestRefinements = {
  workspaceId,
  suggestionId: (schema: z.ZodString) => schema.regex(ULID),
  mergeKey: (schema: z.ZodString) => schema.trim().min(1),
  ...conceptFileRefinements,
  conceptKind,
  // The bound the column holds, held here too, so a payload too large to store is refused
  // where a caller can be told rather than by the row it never reached.
  body: (schema: z.ZodString) => schema.max(SUGGESTION_BODY_MAX),
  baseContentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
};

export const conceptWriteRequestSelect = createSelectSchema(
  conceptWriteRequest,
  conceptWriteRequestRefinements,
);
export const conceptWriteRequestInsert = createInsertSchema(
  conceptWriteRequest,
  conceptWriteRequestRefinements,
);
export const conceptWriteRequestUpdate = createUpdateSchema(
  conceptWriteRequest,
  conceptWriteRequestRefinements,
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
  graphGeneration: {
    table: graphGeneration,
    select: graphGenerationSelect,
    insert: graphGenerationInsert,
    update: graphGenerationUpdate,
  },
  graphNode: {
    table: graphNode,
    select: graphNodeSelect,
    insert: graphNodeInsert,
    update: graphNodeUpdate,
  },
  graphEdge: {
    table: graphEdge,
    select: graphEdgeSelect,
    insert: graphEdgeInsert,
    update: graphEdgeUpdate,
  },
  suggestion: {
    table: suggestion,
    select: suggestionSelect,
    insert: suggestionInsert,
    update: suggestionUpdate,
  },
  conceptWriteRequest: {
    table: conceptWriteRequest,
    select: conceptWriteRequestSelect,
    insert: conceptWriteRequestInsert,
    update: conceptWriteRequestUpdate,
  },
  conceptEvidence: {
    table: conceptEvidence,
    select: conceptEvidenceSelect,
    insert: conceptEvidenceInsert,
    update: conceptEvidenceUpdate,
  },
  conceptClassOverride: {
    table: conceptClassOverride,
    select: conceptClassOverrideSelect,
    insert: conceptClassOverrideInsert,
    update: conceptClassOverrideUpdate,
  },
  sourceBinding: {
    table: sourceBinding,
    select: sourceBindingSelect,
    insert: sourceBindingInsert,
    update: sourceBindingUpdate,
  },
  sourceDocument: {
    table: sourceDocument,
    select: sourceDocumentSelect,
    insert: sourceDocumentInsert,
    update: sourceDocumentUpdate,
  },
  composition: {
    table: composition,
    select: compositionSelect,
    insert: compositionInsert,
    update: compositionUpdate,
  },
  compositionInclude: {
    table: compositionInclude,
    select: compositionIncludeSelect,
    insert: compositionIncludeInsert,
    update: compositionIncludeUpdate,
  },
} as const;
