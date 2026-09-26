import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  accessRequest,
  ACCESS_REQUEST_REASON_MAX,
  ACCESS_REQUEST_STATUSES,
} from "./access-request-tables.ts";
import { ACTOR_ID as ACTOR_ID_REGEX } from "./actor-id.ts";
import { ACT, auditEvent, FAMILIES, identityAuditEvent } from "./audit-tables.ts";
import { composition, compositionInclude } from "./composition-tables.ts";
import {
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
  VERIFICATION_ORIGINS,
} from "./concept-tables.ts";
import { CONTRACT_DIGEST_PATTERN } from "./contract-digest.ts";
import { INGRESS_SCOPES, ingressCounter, mcpCallCounter } from "./counter-tables.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import {
  erasureRequest,
  type SUBJECT_IDENTIFIER_KINDS,
  SUBJECT_IDENTIFIER_MAX,
  SUBJECT_IDENTIFIERS_MAX,
  SUBJECT_REQUEST_KINDS,
  subjectRequest,
  suppression,
  SUPPRESSION_SIGN_IN_ADDRESSES_MAX,
} from "./erasure-tables.ts";
import {
  finding,
  FINDING_REASON_MAX,
  FINDING_REVIEW_STATES,
  REDACTION_TIERS,
} from "./finding-tables.ts";
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
import { job, JOB_KINDS, JOB_REASONS, JOB_STATUSES } from "./job-tables.ts";
import { contractStamp, sweepPass, UPLOAD_SWEEP_MODES } from "./platform-tables.ts";
import { AUDIENCES, SENSITIVITIES } from "./readable-columns.ts";
import { ROLES } from "./roles.ts";
import { llmRoute, workspaceConfig } from "./schema.ts";
import {
  BINDING_STATES,
  CONNECTORS,
  DESTINATIONS,
  DOCUMENT_OUTCOMES,
  QUARANTINE_ERROR,
  RETENTION_CLASSES,
  type RULES_IN_FORCE_KEYS,
  sourceBinding,
  sourceDocument,
} from "./source-tables.ts";
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

const workspaceId = (schema: z.ZodString) => schema.regex(ULID).brand<"WorkspaceId">();
const userId = (schema: z.ZodString) => schema.regex(ULID).brand<"UserId">();

const groupId = (schema: z.ZodString) => schema.regex(ULID).brand<"GroupId">();

const bindingId = (schema: z.ZodString) => schema.regex(ULID).brand<"BindingId">();

const compositionId = (schema: z.ZodString) => schema.regex(ULID).brand<"CompositionId">();

const identityId = (schema: z.ZodString) => schema.regex(ULID);

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

  retentionTail: (schema: z.ZodString) => schema.trim().min(1),
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

const readableUnit = {
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
  audience: (schema: z.ZodString) => schema.pipe(z.enum(AUDIENCES)),
  audienceGroups: (schema: z.ZodArray<z.ZodString>) => z.array(groupId(schema.element)).min(1),
};

const chunkRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId,

  embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS).nullable(),
  embeddingRouteId: (schema: z.ZodString) => schema.trim().min(1),
  bindingId: (schema: z.ZodString) => schema.trim().min(1),
  sourceDocumentId: (schema: z.ZodString) => schema.trim().min(1),
  locator: (schema: z.ZodString) => schema.trim().min(1),
  ordinal: (schema: z.ZodNumber) => schema.int().nonnegative(),
  charStart: (schema: z.ZodNumber) => schema.int().nonnegative(),
  charEnd: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

export const chunkSelect = createSelectSchema(chunk, {
  ...chunkRefinements,
  search: z.string().optional(),
});
export const chunkInsert = createInsertSchema(chunk, chunkRefinements);

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

  origin: (schema: z.ZodString) => schema.pipe(z.enum(GROUP_ORIGINS)),
};

export const groupSelect = createSelectSchema(group, groupRefinements);
export const groupInsert = createInsertSchema(group, groupRefinements);
export const groupUpdate = createUpdateSchema(group, groupRefinements);

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
  scope: (schema: z.ZodString) => schema.pipe(z.enum(INGRESS_SCOPES)),
  key: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

export const ingressCounterSelect = createSelectSchema(ingressCounter, ingressCounterRefinements);
export const ingressCounterInsert = createInsertSchema(ingressCounter, ingressCounterRefinements);
export const ingressCounterUpdate = createUpdateSchema(ingressCounter, ingressCounterRefinements);

const contractStampRefinements = {
  onlyRow: (schema: z.ZodBoolean) => schema.pipe(z.literal(true)),
  digest: (schema: z.ZodString) => schema.regex(CONTRACT_DIGEST_PATTERN),
};

export const contractStampSelect = createSelectSchema(contractStamp, contractStampRefinements);
export const contractStampInsert = createInsertSchema(contractStamp, contractStampRefinements);
export const contractStampUpdate = createUpdateSchema(contractStamp, contractStampRefinements);

const aCount = (schema: z.ZodNumber) => schema.int().nonnegative();

const sweepPassRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID),
  uploadSweep: (schema: z.ZodString) => schema.pipe(z.enum(UPLOAD_SWEEP_MODES)),
  workspaces: aCount,
  refused: aCount,
  found: aCount,
  removed: aCount,
  generations: aCount,
};

export const sweepPassSelect = createSelectSchema(sweepPass, sweepPassRefinements);
export const sweepPassInsert = createInsertSchema(sweepPass, sweepPassRefinements);
export const sweepPassUpdate = createUpdateSchema(sweepPass, sweepPassRefinements);

export { ACTOR_ID } from "./actor-id.ts";

const detail = z.union([
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  z.null(),
]);

/** One id space across both audit logs: an audit event's id, whichever audit log holds its row. */
const auditLogRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID).brand<"AuditEventId">(),
  act: (schema: z.ZodString) =>
    schema.regex(ACT).pipe(z.templateLiteral([z.enum(FAMILIES), ".", z.string(), ".", z.string()])),
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  subjectId: (schema: z.ZodString) => schema.trim().min(1),
  detail: (schema: z.ZodType) => schema.pipe(detail),
  batchId: (schema: z.ZodString) => schema.regex(ULID),
};

const auditLogDerivedRefinements = {
  family: (schema: z.ZodString) => schema.pipe(z.enum(FAMILIES)),
  subjectKind: (schema: z.ZodString) => schema.trim().min(1),
};

const auditEventRefinements = { ...auditLogRefinements, workspaceId };

export const auditEventSelect = createSelectSchema(auditEvent, {
  ...auditEventRefinements,
  ...auditLogDerivedRefinements,
});
export const auditEventInsert = createInsertSchema(auditEvent, auditEventRefinements);
export const auditEventUpdate = createUpdateSchema(auditEvent, auditEventRefinements);

export const identityAuditEventSelect = createSelectSchema(identityAuditEvent, {
  ...auditLogRefinements,
  ...auditLogDerivedRefinements,
});
export const identityAuditEventInsert = createInsertSchema(identityAuditEvent, auditLogRefinements);
export const identityAuditEventUpdate = createUpdateSchema(identityAuditEvent, auditLogRefinements);

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

const conceptIri = (schema: z.ZodString) => schema.regex(IRI).brand<"ConceptIri">();

const frontmatterEntry = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .refine((entry) => Object.keys(entry).length > 0, {
    message: "a list entry carries at least one key",
  });

const namesAResource = (entry: z.infer<typeof frontmatterEntry> | string): boolean =>
  citedSourceOf(entry) !== undefined;

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

const conceptFileRefinements = {
  path: (schema: z.ZodString) => schema.regex(CONCEPT_PATH),
  title: (schema: z.ZodString) => schema.trim().min(1),
  frontmatter: (schema: z.ZodType) => schema.pipe(frontmatter),
};

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

const rulesInForce = z.union([
  // Spelled out against the tuple: `satisfies` refuses a key it lacks and a member the literal
  // misses.
  z.strictObject({
    default_on: z.boolean(),
    default_off: z.boolean(),
  } satisfies Record<(typeof RULES_IN_FORCE_KEYS)[number], z.ZodBoolean>),
  z.null(),
]);

const sourceBindingRefinements = {
  workspaceId,
  id: bindingId,
  ...readableUnit,
  name: (schema: z.ZodString) => schema.trim().min(1),
  connector: (schema: z.ZodString) => schema.pipe(z.enum(CONNECTORS)),
  destination: (schema: z.ZodArray<z.ZodString>) =>
    z.array(schema.element.pipe(z.enum(DESTINATIONS))).min(1),
  retentionClass: (schema: z.ZodString) => schema.pipe(z.enum(RETENTION_CLASSES)),
  state: (schema: z.ZodString) => schema.pipe(z.enum(BINDING_STATES)),
  rulesInForce: (schema: z.ZodType) => schema.pipe(rulesInForce),
};

export const sourceBindingSelect = createSelectSchema(sourceBinding, sourceBindingRefinements);
export const sourceBindingInsert = createInsertSchema(sourceBinding, sourceBindingRefinements);
export const sourceBindingUpdate = createUpdateSchema(sourceBinding, sourceBindingRefinements);

const sourceDocumentRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.trim().min(1),
  bindingId,
  sourceSystemId: (schema: z.ZodString) => schema.trim().min(1),
  title: (schema: z.ZodString) => schema.trim().min(1),
  mediaType: (schema: z.ZodString) => schema.trim().min(1),
  byteSize: (schema: z.ZodNumber) => schema.int().nonnegative(),
  originalKey: (schema: z.ZodString) => schema.trim().min(1),
  normalisedKey: (schema: z.ZodString) => schema.trim().min(1),
  contentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
  redactionVersion: (schema: z.ZodString) => schema.trim().min(1),
  outcome: (schema: z.ZodString) => schema.pipe(z.enum(DOCUMENT_OUTCOMES)),
  quarantineError: (schema: z.ZodString) => schema.regex(QUARANTINE_ERROR),
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
  narrowedTo: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
};

export const sourceDocumentSelect = createSelectSchema(sourceDocument, sourceDocumentRefinements);
export const sourceDocumentInsert = createInsertSchema(sourceDocument, sourceDocumentRefinements);
export const sourceDocumentUpdate = createUpdateSchema(sourceDocument, sourceDocumentRefinements);

const findingRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  documentId: (schema: z.ZodString) => schema.trim().min(1),
  category: (schema: z.ZodString) => schema.trim().min(1),
  tier: (schema: z.ZodString) => schema.pipe(z.enum(REDACTION_TIERS)),
  ruleId: (schema: z.ZodString) => schema.trim().min(1),
  charStart: (schema: z.ZodNumber) => schema.int().nonnegative(),
  charEnd: (schema: z.ZodNumber) => schema.int().positive(),
  score: (schema: z.ZodNumber) => schema.min(0).max(1),
  ruleVersion: (schema: z.ZodString) => schema.trim().min(1),
  detectorPin: (schema: z.ZodString) => schema.trim().min(1),
  reviewState: (schema: z.ZodString) => schema.pipe(z.enum(FINDING_REVIEW_STATES)),
  reviewedBy: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  reviewReason: (schema: z.ZodString) => schema.trim().min(1).max(FINDING_REASON_MAX),
  restoredBy: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  restoreReason: (schema: z.ZodString) => schema.trim().min(1).max(FINDING_REASON_MAX),
};

export const findingSelect = createSelectSchema(finding, findingRefinements);
export const findingInsert = createInsertSchema(finding, findingRefinements);
export const findingUpdate = createUpdateSchema(finding, findingRefinements);

const subjectIdentifier = z.string().trim().min(1).max(SUBJECT_IDENTIFIER_MAX);
const subjectIdentifierList = z.array(subjectIdentifier).max(SUBJECT_IDENTIFIERS_MAX);
const identifierSetOf = (emailsMax: number) =>
  z.union([
    // As above: the tuple's members, each spelled out and checked against it.
    z.strictObject({
      emails: z.array(subjectIdentifier).max(emailsMax),
      names: subjectIdentifierList,
      other: subjectIdentifierList,
    } satisfies Record<(typeof SUBJECT_IDENTIFIER_KINDS)[number], typeof subjectIdentifierList>),
    z.null(),
  ]);
const subjectIdentifiers = identifierSetOf(SUBJECT_IDENTIFIERS_MAX);

const subjectRequestRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  kind: (schema: z.ZodString) => schema.pipe(z.enum(SUBJECT_REQUEST_KINDS)),
  personId: (schema: z.ZodString) => schema.regex(ULID),
  identifiers: (schema: z.ZodType) => schema.pipe(subjectIdentifiers),
  answer: (schema: z.ZodString) => schema.trim().min(1),
};

export const subjectRequestSelect = createSelectSchema(subjectRequest, subjectRequestRefinements);
export const subjectRequestInsert = createInsertSchema(subjectRequest, subjectRequestRefinements);
export const subjectRequestUpdate = createUpdateSchema(subjectRequest, subjectRequestRefinements);

const erasureAction = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const erasureActions = z.union([
  z.record(z.string(), z.record(z.string(), erasureAction)),
  z.null(),
]);

const erasureRequestRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  subjectRequestId: (schema: z.ZodString) => schema.regex(ULID),
  pseudonym: (schema: z.ZodString) => schema.regex(ULID),
  actions: (schema: z.ZodType) => schema.pipe(erasureActions),
  report: (schema: z.ZodString) => schema.trim().min(1),
};

export const erasureRequestSelect = createSelectSchema(erasureRequest, erasureRequestRefinements);
export const erasureRequestInsert = createInsertSchema(erasureRequest, erasureRequestRefinements);
export const erasureRequestUpdate = createUpdateSchema(erasureRequest, erasureRequestRefinements);

const suppressionIdentifiers = identifierSetOf(
  SUBJECT_IDENTIFIERS_MAX + SUPPRESSION_SIGN_IN_ADDRESSES_MAX,
);

const suppressionRefinements = {
  workspaceId,
  erasureRequestId: (schema: z.ZodString) => schema.regex(ULID),
  identifiers: (schema: z.ZodType) => schema.pipe(suppressionIdentifiers),
};

export const suppressionSelect = createSelectSchema(suppression, suppressionRefinements);
export const suppressionInsert = createInsertSchema(suppression, suppressionRefinements);
export const suppressionUpdate = createUpdateSchema(suppression, suppressionRefinements);

const compositionRefinements = {
  workspaceId,
  id: compositionId,
  ...readableUnit,
};

export const compositionSelect = createSelectSchema(composition, compositionRefinements);
export const compositionInsert = createInsertSchema(composition, compositionRefinements);
export const compositionUpdate = createUpdateSchema(composition, compositionRefinements);

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

const graphLabel = (labels: readonly string[]) => (schema: z.ZodString) =>
  schema.refine(
    (label) =>
      labels.some((known) => known === label) || label.startsWith(SOURCE_ENTITY_LABEL_PREFIX),
    { message: "a graph label is one of the closed set, or wears the source-entity prefix" },
  );

type GraphRowInput = { readonly label: string; readonly gen?: number | null };

const sourceEntityCarriesNoGen = (row: GraphRowInput): boolean =>
  !row.label.startsWith(SOURCE_ENTITY_LABEL_PREFIX) || row.gen === null || row.gen === undefined;

const closedNodeLabelCarriesGen = (row: GraphRowInput): boolean =>
  row.label.startsWith(SOURCE_ENTITY_LABEL_PREFIX) || (row.gen !== null && row.gen !== undefined);

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

const graphKey = (schema: z.ZodString) => schema.trim().min(1);

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

const outcomeScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const outcome = z.union([
  z.record(
    z.string(),
    z.union([outcomeScalar, z.array(outcomeScalar), z.array(z.record(z.string(), outcomeScalar))]),
  ),
  z.null(),
]);

const jobRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  subjectId: (schema: z.ZodString) => schema.trim().min(1),
  kind: (schema: z.ZodString) => schema.pipe(z.enum(JOB_KINDS)),

  reason: (schema: z.ZodString) => schema.pipe(z.enum(JOB_REASONS)),
  status: (schema: z.ZodString) => schema.pipe(z.enum(JOB_STATUSES)),
  attempts: (schema: z.ZodNumber) => schema.int().nonnegative(),
  maxAttempts: (schema: z.ZodNumber) => schema.int().positive(),
  claimedBy: (schema: z.ZodString) => schema.trim().min(1),
  outcome: (schema: z.ZodType) => schema.pipe(outcome),
};

export const jobSelect = createSelectSchema(job, jobRefinements);
export const jobInsert = createInsertSchema(job, jobRefinements);
export const jobUpdate = createUpdateSchema(job, jobRefinements);

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

const conceptWriteRequestRefinements = {
  workspaceId,
  suggestionId: (schema: z.ZodString) => schema.regex(ULID),
  mergeKey: (schema: z.ZodString) => schema.trim().min(1),
  ...conceptFileRefinements,
  conceptKind,

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
  identityAuditEvent: {
    table: identityAuditEvent,
    select: identityAuditEventSelect,
    insert: identityAuditEventInsert,
    update: identityAuditEventUpdate,
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
  contractStamp: {
    table: contractStamp,
    select: contractStampSelect,
    insert: contractStampInsert,
    update: contractStampUpdate,
  },
  sweepPass: {
    table: sweepPass,
    select: sweepPassSelect,
    insert: sweepPassInsert,
    update: sweepPassUpdate,
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
  job: { table: job, select: jobSelect, insert: jobInsert, update: jobUpdate },
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
  finding: {
    table: finding,
    select: findingSelect,
    insert: findingInsert,
    update: findingUpdate,
  },
  subjectRequest: {
    table: subjectRequest,
    select: subjectRequestSelect,
    insert: subjectRequestInsert,
    update: subjectRequestUpdate,
  },
  erasureRequest: {
    table: erasureRequest,
    select: erasureRequestSelect,
    insert: erasureRequestInsert,
    update: erasureRequestUpdate,
  },
  suppression: {
    table: suppression,
    select: suppressionSelect,
    insert: suppressionInsert,
    update: suppressionUpdate,
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
