import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  accessRequest,
  ACCESS_REQUEST_REASON_MAX,
  ACCESS_REQUEST_STATUSES,
} from "./access-request-tables.ts";
import { ACTOR_ID as ACTOR_ID_REGEX } from "./actor-id.ts";
import { ACTION, auditEvent, FAMILIES, identityAuditEvent } from "./audit-tables.ts";
import {
  bundleCommit,
  CONCEPT_BODY_MAX,
  CONCEPT_FRONTMATTER_MAX,
  CONCEPT_IRI,
  CONCEPT_PATH,
  CONCEPT_STATUSES,
  conceptSensitivityOverride,
  conceptEvidence,
  conceptIdentity,
  conceptIndex,
  citedSourceOf,
  conceptVerification,
  CONTENT_HASH,
  evidence,
  GIT_SHA,
  VERIFICATION_ORIGINS,
} from "./concept-tables.ts";
import { CONTRACT_DIGEST_PATTERN } from "./contract-digest.ts";
import {
  INGRESS_SCOPES,
  ingressCounter,
  invitationEmailCounter,
  mcpCallCounter,
} from "./counter-tables.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { EMAIL_ADDRESS } from "./email-address.ts";
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
import { group, GROUP_ORIGINS, groupMember } from "./group-tables.ts";
import {
  account,
  authenticator,
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
  passkey,
  passkeyLastUse,
  rateLimit,
  recoveryCode,
  secondFactorThrottle,
  session,
  user,
  verification,
} from "./identity-tables.ts";
import { passage, EMBEDDING_DIMENSIONS } from "./index-tables.ts";
import { job, JOB_KINDS, JOB_REASONS, JOB_STATUSES } from "./job-tables.ts";
import { workspaceLastActive } from "./last-active-tables.ts";
import {
  CALENDAR_DAY,
  DECIMAL_STRING,
  LLM_CALL_OUTCOMES,
  llmCall,
  MODEL_NAME,
  MODEL_PROVIDERS,
  modelKey,
  modelPrice,
  spendReservation,
} from "./llm-tables.ts";
import {
  MAP_EDGE_LABELS,
  MAP_NODE_LABELS,
  mapEdge,
  mapGeneration,
  mapNode,
  SOURCE_ENTITY_LABEL_PREFIX,
} from "./map-tables.ts";
import { contractStamp, sweepPass, UPLOAD_SWEEP_MODES } from "./platform-tables.ts";
import {
  CANDIDATE_VERDICTS,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  FLAG_CLOSINGS,
  JUDGE_STATES,
  QUESTION_TRANSPORTS,
  QUESTION_VERDICTS,
  questionAsked,
  questionContent,
  questionFeedback,
} from "./question-tables.ts";
import { AUDIENCES, SENSITIVITIES } from "./readable-columns.ts";
import { ROLES } from "./roles.ts";
import { modelChoice, workspaceConfig } from "./schema.ts";
import {
  CONNECTED_SOURCE_STATES,
  CONNECTORS,
  DESTINATIONS,
  DOCUMENT_OUTCOMES,
  UNREADABLE_REASON,
  RETENTION_CLASSES,
  type RULES_IN_FORCE_KEYS,
  connectedSource,
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
import { testWorkspaceMark } from "./test-workspace-tables.ts";
import { ULID } from "./ulid.ts";
import { workspace } from "./workspace-table.ts";
import { writeUp, writeUpInclude } from "./write-up-tables.ts";

const workspaceId = (schema: z.ZodString) => schema.regex(ULID).brand<"WorkspaceId">();
const userId = (schema: z.ZodString) => schema.regex(ULID).brand<"UserId">();

const groupId = (schema: z.ZodString) => schema.regex(ULID).brand<"GroupId">();

const connectedSourceId = (schema: z.ZodString) => schema.regex(ULID).brand<"ConnectedSourceId">();

const writeUpId = (schema: z.ZodString) => schema.regex(ULID).brand<"WriteUpId">();

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
  shortName: (schema: z.ZodString) => schema.trim().min(1),
};

const workspaceSelect = createSelectSchema(workspace, workspaceRefinements);
const workspaceInsert = createInsertSchema(workspace, workspaceRefinements);
const workspaceUpdate = createUpdateSchema(workspace, workspaceRefinements);

const modelChoiceRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId,
  provider: (schema: z.ZodString) => schema.trim().min(1),
  model: (schema: z.ZodString) => schema.trim().min(1),
  dimensions: (schema: z.ZodNumber) => schema.int().positive(),

  retentionTail: (schema: z.ZodString) => schema.trim().min(1),
};

const modelChoiceSelect = createSelectSchema(modelChoice, modelChoiceRefinements);
const modelChoiceInsert = createInsertSchema(modelChoice, modelChoiceRefinements);
const modelChoiceUpdate = createUpdateSchema(modelChoice, modelChoiceRefinements);

/** The driver hands a `bytea` back as bytes, and a frame is written as bytes. */
const sealedFrame = z.instanceof(Uint8Array);

const modelKeyRefinements = {
  workspaceId,
  provider: (schema: z.ZodString) => schema.pipe(z.enum(MODEL_PROVIDERS)),
  sealed: sealedFrame,
};

const modelKeySelect = createSelectSchema(modelKey, modelKeyRefinements);
const modelKeyInsert = createInsertSchema(modelKey, modelKeyRefinements);
const modelKeyUpdate = createUpdateSchema(modelKey, {
  ...modelKeyRefinements,
  sealed: sealedFrame.optional(),
});

/** Money and rates are `numeric`, which the driver hands back as a string and never a float. */
const decimal = (schema: z.ZodString) => schema.regex(DECIMAL_STRING);

const tokenCount = (schema: z.ZodNumber) => schema.int().nonnegative();

const servedBy = {
  modelChoiceId: (schema: z.ZodString) => schema.trim().min(1),
  model: (schema: z.ZodString) => schema.trim().min(1),
  runId: (schema: z.ZodString) => schema.trim().min(1),
  answerId: (schema: z.ZodString) => schema.regex(ULID),
};

const llmCallRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  ...servedBy,
  tokensIn: tokenCount,
  tokensOut: tokenCount,
  seconds: (schema: z.ZodNumber) => schema.nonnegative(),
  costGbp: decimal,
  outcome: (schema: z.ZodString) => schema.pipe(z.enum(LLM_CALL_OUTCOMES)),
};

const llmCallSelect = createSelectSchema(llmCall, llmCallRefinements);
const llmCallInsert = createInsertSchema(llmCall, llmCallRefinements);
const llmCallUpdate = createUpdateSchema(llmCall, llmCallRefinements);

const spendReservationRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  ...servedBy,
  mostTokensIn: tokenCount,
  mostTokensOut: tokenCount,
  gbpPerMillionIn: decimal,
  gbpPerMillionOut: decimal,
  reservedGbp: decimal,
};

const spendReservationSelect = createSelectSchema(spendReservation, spendReservationRefinements);
const spendReservationInsert = createInsertSchema(spendReservation, spendReservationRefinements);
const spendReservationUpdate = createUpdateSchema(spendReservation, spendReservationRefinements);

const modelPriceRefinements = {
  provider: (schema: z.ZodString) => schema.pipe(z.enum(MODEL_PROVIDERS)),
  model: (schema: z.ZodString) => schema.regex(MODEL_NAME),
  effectiveFrom: (schema: z.ZodString) => schema.regex(CALENDAR_DAY),
  gbpPerMillionIn: decimal,
  gbpPerMillionOut: decimal,
};

const modelPriceSelect = createSelectSchema(modelPrice, modelPriceRefinements);
const modelPriceInsert = createInsertSchema(modelPrice, modelPriceRefinements);
const modelPriceUpdate = createUpdateSchema(modelPrice, modelPriceRefinements);

const workspaceConfigRefinements = {
  workspaceId,
  key: (schema: z.ZodString) => schema.trim().min(1),
};

const workspaceConfigSelect = createSelectSchema(workspaceConfig, workspaceConfigRefinements);
const workspaceConfigInsert = createInsertSchema(workspaceConfig, workspaceConfigRefinements);
const workspaceConfigUpdate = createUpdateSchema(workspaceConfig, workspaceConfigRefinements);

const readableUnit = {
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
  audience: (schema: z.ZodString) => schema.pipe(z.enum(AUDIENCES)),
  audienceGroups: (schema: z.ZodArray<z.ZodString>) => z.array(groupId(schema.element)).min(1),
};

const passageRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId,

  embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS).nullable(),
  embeddingModelChoiceId: (schema: z.ZodString) => schema.trim().min(1),
  connectedSourceId: (schema: z.ZodString) => schema.trim().min(1),
  sourceDocumentId: (schema: z.ZodString) => schema.trim().min(1),
  locator: (schema: z.ZodString) => schema.trim().min(1),
  ordinal: (schema: z.ZodNumber) => schema.int().nonnegative(),
  charStart: (schema: z.ZodNumber) => schema.int().nonnegative(),
  charEnd: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

const passageSelect = createSelectSchema(passage, {
  ...passageRefinements,
  search: z.string().optional(),
});
const passageInsert = createInsertSchema(passage, passageRefinements);

const passageUpdate = createUpdateSchema(passage, {
  ...passageRefinements,
  embedding: passageRefinements.embedding.optional(),
});

const userRefinements = {
  id: userId,
  email: (schema: z.ZodString) => schema.trim().min(1),
};

const userSelect = createSelectSchema(user, userRefinements);
const userInsert = createInsertSchema(user, userRefinements);
const userUpdate = createUpdateSchema(user, userRefinements);

const memberRefinements = {
  id: identityId,
  workspaceId,
  userId,

  role: (schema: z.ZodString) => schema.pipe(z.enum(ROLES)),
};

const memberSelect = createSelectSchema(member, memberRefinements);
const memberInsert = createInsertSchema(member, memberRefinements);
const memberUpdate = createUpdateSchema(member, memberRefinements);

const sessionRefinements = { id: identityId };

const sessionSelect = createSelectSchema(session, sessionRefinements);
const sessionInsert = createInsertSchema(session, sessionRefinements);
const sessionUpdate = createUpdateSchema(session, sessionRefinements);

const invitationRefinements = { id: identityId };

const invitationSelect = createSelectSchema(invitation, invitationRefinements);
const invitationInsert = createInsertSchema(invitation, invitationRefinements);
const invitationUpdate = createUpdateSchema(invitation, invitationRefinements);

const groupRefinements = {
  id: groupId,
  workspaceId,
  name: (schema: z.ZodString) => schema.trim().min(1),

  origin: (schema: z.ZodString) => schema.pipe(z.enum(GROUP_ORIGINS)),
};

const groupSelect = createSelectSchema(group, groupRefinements);
const groupInsert = createInsertSchema(group, groupRefinements);
const groupUpdate = createUpdateSchema(group, groupRefinements);

const groupMemberRefinements = { workspaceId, groupId, userId };

const groupMemberSelect = createSelectSchema(groupMember, groupMemberRefinements);
const groupMemberInsert = createInsertSchema(groupMember, groupMemberRefinements);
const groupMemberUpdate = createUpdateSchema(groupMember, groupMemberRefinements);

const mcpCallCounterRefinements = {
  workspaceId,
  tokenId: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

const mcpCallCounterSelect = createSelectSchema(mcpCallCounter, mcpCallCounterRefinements);
const mcpCallCounterInsert = createInsertSchema(mcpCallCounter, mcpCallCounterRefinements);
const mcpCallCounterUpdate = createUpdateSchema(mcpCallCounter, mcpCallCounterRefinements);

const invitationEmailCounterRefinements = {
  workspaceId,
  key: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

const invitationEmailCounterSelect = createSelectSchema(
  invitationEmailCounter,
  invitationEmailCounterRefinements,
);
const invitationEmailCounterInsert = createInsertSchema(
  invitationEmailCounter,
  invitationEmailCounterRefinements,
);
const invitationEmailCounterUpdate = createUpdateSchema(
  invitationEmailCounter,
  invitationEmailCounterRefinements,
);

const isTestingDomain = (testingDomain: string): boolean =>
  testingDomain === testingDomain.toLowerCase() &&
  EMAIL_ADDRESS.safeParse(`mark@${testingDomain}`).success;

const testWorkspaceMarkRefinements = {
  workspaceId,
  testingDomain: (schema: z.ZodString) => schema.refine(isTestingDomain),
};

const testWorkspaceMarkSelect = createSelectSchema(testWorkspaceMark, testWorkspaceMarkRefinements);
const testWorkspaceMarkInsert = createInsertSchema(testWorkspaceMark, testWorkspaceMarkRefinements);
const testWorkspaceMarkUpdate = createUpdateSchema(testWorkspaceMark, testWorkspaceMarkRefinements);

const ingressCounterRefinements = {
  scope: (schema: z.ZodString) => schema.pipe(z.enum(INGRESS_SCOPES)),
  key: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

const ingressCounterSelect = createSelectSchema(ingressCounter, ingressCounterRefinements);
const ingressCounterInsert = createInsertSchema(ingressCounter, ingressCounterRefinements);
const ingressCounterUpdate = createUpdateSchema(ingressCounter, ingressCounterRefinements);

const contractStampRefinements = {
  onlyRow: (schema: z.ZodBoolean) => schema.pipe(z.literal(true)),
  digest: (schema: z.ZodString) => schema.regex(CONTRACT_DIGEST_PATTERN),
};

const contractStampSelect = createSelectSchema(contractStamp, contractStampRefinements);
const contractStampInsert = createInsertSchema(contractStamp, contractStampRefinements);
const contractStampUpdate = createUpdateSchema(contractStamp, contractStampRefinements);

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

const sweepPassSelect = createSelectSchema(sweepPass, sweepPassRefinements);
const sweepPassInsert = createInsertSchema(sweepPass, sweepPassRefinements);
const sweepPassUpdate = createUpdateSchema(sweepPass, sweepPassRefinements);

export { ACTOR_ID } from "./actor-id.ts";

const detailEntry = z.record(z.string(), z.union([z.string(), z.null()]));

const detail = z.union([
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(detailEntry)])),
  z.null(),
]);

const auditLogRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID).brand<"AuditEventId">(),
  action: (schema: z.ZodString) =>
    schema
      .regex(ACTION)
      .pipe(z.templateLiteral([z.enum(FAMILIES), ".", z.string(), ".", z.string()])),
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

const auditEventSelect = createSelectSchema(auditEvent, {
  ...auditEventRefinements,
  ...auditLogDerivedRefinements,
});
const auditEventInsert = createInsertSchema(auditEvent, auditEventRefinements);
const auditEventUpdate = createUpdateSchema(auditEvent, auditEventRefinements);

const identityAuditEventSelect = createSelectSchema(identityAuditEvent, {
  ...auditLogRefinements,
  ...auditLogDerivedRefinements,
});
const identityAuditEventInsert = createInsertSchema(identityAuditEvent, auditLogRefinements);
const identityAuditEventUpdate = createUpdateSchema(identityAuditEvent, auditLogRefinements);

const accessRequestRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID).brand<"AccessRequestId">(),
  workspaceId,
  requesterId: userId,
  reason: (schema: z.ZodString) => schema.trim().min(1).max(ACCESS_REQUEST_REASON_MAX),
  status: (schema: z.ZodString) => schema.pipe(z.enum(ACCESS_REQUEST_STATUSES)),
  decidedBy: userId,
  invitationId: identityId,
};

const accessRequestSelect = createSelectSchema(accessRequest, accessRequestRefinements);
const accessRequestInsert = createInsertSchema(accessRequest, accessRequestRefinements);
const accessRequestUpdate = createUpdateSchema(accessRequest, accessRequestRefinements);

const conceptIri = (schema: z.ZodString) => schema.pipe(CONCEPT_IRI);

const PROTO_FAMILY = /^_{2,}proto__$/;
const ESCAPED_PROTO_FAMILY = /^_{3,}proto__$/;

const withKeysRenamed = <Value>(
  record: Readonly<Record<string, Value>>,
  rename: (key: string) => string,
): Record<string, Value> =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [rename(key), value]));

/** zod's record drops an own "__proto__" key unvalidated, so the key is escaped past it and restored. */
export const recordKeepingEveryKey = <Value extends z.ZodType>(value: Value) =>
  z
    .preprocess(
      (input) =>
        typeof input === "object" &&
        input !== null &&
        [Object.prototype, null].includes(Object.getPrototypeOf(input))
          ? withKeysRenamed({ ...input }, (key) => (PROTO_FAMILY.test(key) ? `_${key}` : key))
          : input,
      z.record(z.string(), value),
    )
    .overwrite((record) =>
      withKeysRenamed(record, (key) => (ESCAPED_PROTO_FAMILY.test(key) ? key.slice(1) : key)),
    );

const frontmatterEntry = recordKeepingEveryKey(
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
).refine((entry) => Object.keys(entry).length > 0, {
  message: "a list entry carries at least one key",
});

const namesAResource = (entry: z.infer<typeof frontmatterEntry> | string): boolean =>
  citedSourceOf(entry) !== undefined;

export const conceptFrontmatter = recordKeepingEveryKey(
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.string()),
    z.array(frontmatterEntry),
  ]),
).superRefine((value, context) => {
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

const conceptIdentitySelect = createSelectSchema(conceptIdentity, conceptIdentityRefinements);
const conceptIdentityInsert = createInsertSchema(conceptIdentity, conceptIdentityRefinements);
const conceptIdentityUpdate = createUpdateSchema(conceptIdentity, conceptIdentityRefinements);

const conceptFileRefinements = {
  path: (schema: z.ZodString) => schema.regex(CONCEPT_PATH),
  title: (schema: z.ZodString) => schema.trim().min(1),
  frontmatter: () => frontmatter,
};

const conceptKind = (schema: z.ZodString) => schema.trim().min(1);

const conceptIndexRefinements = {
  workspaceId,
  iri: conceptIri,
  ...conceptFileRefinements,
  body: (schema: z.ZodString) =>
    schema.refine(
      (body) => {
        let characters = 0;
        for (const _ of body) characters += 1;
        return characters <= CONCEPT_BODY_MAX;
      },
      { message: `a concept's body is at most ${CONCEPT_BODY_MAX} characters` },
    ),
  kind: conceptKind,
  contentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
  commitSha: (schema: z.ZodString) => schema.regex(GIT_SHA),
  status: (schema: z.ZodString) => schema.pipe(z.enum(CONCEPT_STATUSES)),
  ...readableUnit,
};

const conceptIndexSelect = createSelectSchema(conceptIndex, {
  ...conceptIndexRefinements,
  search: z.string().optional(),
});
const conceptIndexInsert = createInsertSchema(conceptIndex, conceptIndexRefinements);
const conceptIndexUpdate = createUpdateSchema(conceptIndex, conceptIndexRefinements);

const bundleCommitRefinements = {
  workspaceId,
  sha: (schema: z.ZodString) => schema.regex(GIT_SHA),
  parentSha: (schema: z.ZodString) => schema.regex(GIT_SHA),
  auditEventId: (schema: z.ZodString) => schema.regex(ULID),
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
};

const bundleCommitSelect = createSelectSchema(bundleCommit, bundleCommitRefinements);
const bundleCommitInsert = createInsertSchema(bundleCommit, bundleCommitRefinements);
const bundleCommitUpdate = createUpdateSchema(bundleCommit, bundleCommitRefinements);

const evidenceRefinements = {
  workspaceId,
  sourceDocumentId: (schema: z.ZodString) => schema.trim().min(1),
  locator: (schema: z.ZodString) => schema.trim().min(1),
  resource: (schema: z.ZodString) => schema.trim().min(1),
  contentVersion: (schema: z.ZodString) => schema.trim().min(1),
};

const evidenceSelect = createSelectSchema(evidence, evidenceRefinements);
const evidenceInsert = createInsertSchema(evidence, evidenceRefinements);
const evidenceUpdate = createUpdateSchema(evidence, evidenceRefinements);

const conceptVerificationRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID),
  workspaceId,
  iri: conceptIri,
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  contentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
  origin: (schema: z.ZodString) => schema.pipe(z.enum(VERIFICATION_ORIGINS)),
};

const conceptVerificationSelect = createSelectSchema(
  conceptVerification,
  conceptVerificationRefinements,
);
const conceptVerificationInsert = createInsertSchema(
  conceptVerification,
  conceptVerificationRefinements,
);
const conceptVerificationUpdate = createUpdateSchema(
  conceptVerification,
  conceptVerificationRefinements,
);

const conceptEvidenceRefinements = {
  workspaceId,
  iri: conceptIri,
  sourceDocumentId: (schema: z.ZodString) => schema.trim().min(1),
  locator: (schema: z.ZodString) => schema.trim().min(1),
};

const conceptEvidenceSelect = createSelectSchema(conceptEvidence, conceptEvidenceRefinements);
const conceptEvidenceInsert = createInsertSchema(conceptEvidence, conceptEvidenceRefinements);
const conceptEvidenceUpdate = createUpdateSchema(conceptEvidence, conceptEvidenceRefinements);

const conceptSensitivityOverrideRefinements = {
  workspaceId,
  iri: conceptIri,
  ...readableUnit,
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  auditEventId: (schema: z.ZodString) => schema.regex(ULID),
};

const conceptSensitivityOverrideSelect = createSelectSchema(
  conceptSensitivityOverride,
  conceptSensitivityOverrideRefinements,
);
const conceptSensitivityOverrideInsert = createInsertSchema(
  conceptSensitivityOverride,
  conceptSensitivityOverrideRefinements,
);
const conceptSensitivityOverrideUpdate = createUpdateSchema(
  conceptSensitivityOverride,
  conceptSensitivityOverrideRefinements,
);

const rulesInForce = z.strictObject({
  default_on: z.boolean(),
  default_off: z.boolean(),
} satisfies Record<(typeof RULES_IN_FORCE_KEYS)[number], z.ZodBoolean>);

const connectedSourceRefinements = {
  workspaceId,
  id: connectedSourceId,
  ...readableUnit,
  name: (schema: z.ZodString) => schema.trim().min(1),
  connector: (schema: z.ZodString) => schema.pipe(z.enum(CONNECTORS)),
  destination: (schema: z.ZodArray<z.ZodString>) =>
    z.array(schema.element.pipe(z.enum(DESTINATIONS))).min(1),
  retentionClass: (schema: z.ZodString) => schema.pipe(z.enum(RETENTION_CLASSES)),
  state: (schema: z.ZodString) => schema.pipe(z.enum(CONNECTED_SOURCE_STATES)),
  rulesInForce: (schema: z.ZodType) => schema.pipe(rulesInForce),
};

const connectedSourceSelect = createSelectSchema(connectedSource, connectedSourceRefinements);
const connectedSourceInsert = createInsertSchema(connectedSource, connectedSourceRefinements);
const connectedSourceUpdate = createUpdateSchema(connectedSource, connectedSourceRefinements);

const sourceDocumentRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.trim().min(1),
  connectedSourceId,
  sourceSystemId: (schema: z.ZodString) => schema.trim().min(1),
  title: (schema: z.ZodString) => schema.trim().min(1),
  mediaType: (schema: z.ZodString) => schema.trim().min(1),
  byteSize: (schema: z.ZodNumber) => schema.int().nonnegative(),
  originalKey: (schema: z.ZodString) => schema.trim().min(1),
  normalisedKey: (schema: z.ZodString) => schema.trim().min(1),
  contentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
  redactionVersion: (schema: z.ZodString) => schema.trim().min(1),
  outcome: (schema: z.ZodString) => schema.pipe(z.enum(DOCUMENT_OUTCOMES)),
  unreadableReason: (schema: z.ZodString) => schema.regex(UNREADABLE_REASON),
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
  narrowedTo: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
};

const sourceDocumentSelect = createSelectSchema(sourceDocument, sourceDocumentRefinements);
const sourceDocumentInsert = createInsertSchema(sourceDocument, sourceDocumentRefinements);
const sourceDocumentUpdate = createUpdateSchema(sourceDocument, sourceDocumentRefinements);

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

const findingSelect = createSelectSchema(finding, findingRefinements);
const findingInsert = createInsertSchema(finding, findingRefinements);
const findingUpdate = createUpdateSchema(finding, findingRefinements);

const subjectIdentifier = z.string().trim().min(1).max(SUBJECT_IDENTIFIER_MAX);
const subjectIdentifierList = z.array(subjectIdentifier).max(SUBJECT_IDENTIFIERS_MAX);
const identifierSetOf = (emailsMax: number) =>
  z.strictObject({
    emails: z.array(subjectIdentifier).max(emailsMax),
    names: subjectIdentifierList,
    other: subjectIdentifierList,
  } satisfies Record<(typeof SUBJECT_IDENTIFIER_KINDS)[number], typeof subjectIdentifierList>);
const subjectIdentifiers = identifierSetOf(SUBJECT_IDENTIFIERS_MAX);

const subjectRequestRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  kind: (schema: z.ZodString) => schema.pipe(z.enum(SUBJECT_REQUEST_KINDS)),
  personId: (schema: z.ZodString) => schema.regex(ULID),
  identifiers: (schema: z.ZodType) => schema.pipe(subjectIdentifiers),
  answer: (schema: z.ZodString) => schema.trim().min(1),
};

const subjectRequestSelect = createSelectSchema(subjectRequest, subjectRequestRefinements);
const subjectRequestInsert = createInsertSchema(subjectRequest, subjectRequestRefinements);
const subjectRequestUpdate = createUpdateSchema(subjectRequest, subjectRequestRefinements);

const erasureAction = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const erasureActions = z.record(z.string(), z.record(z.string(), erasureAction));

const erasureRequestRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  subjectRequestId: (schema: z.ZodString) => schema.regex(ULID),
  pseudonym: (schema: z.ZodString) => schema.regex(ULID),
  actions: (schema: z.ZodType) => schema.pipe(erasureActions),
  report: (schema: z.ZodString) => schema.trim().min(1),
};

const erasureRequestSelect = createSelectSchema(erasureRequest, erasureRequestRefinements);
const erasureRequestInsert = createInsertSchema(erasureRequest, erasureRequestRefinements);
const erasureRequestUpdate = createUpdateSchema(erasureRequest, erasureRequestRefinements);

const suppressionIdentifiers = identifierSetOf(
  SUBJECT_IDENTIFIERS_MAX + SUPPRESSION_SIGN_IN_ADDRESSES_MAX,
);

const suppressionRefinements = {
  workspaceId,
  erasureRequestId: (schema: z.ZodString) => schema.regex(ULID),
  identifiers: (schema: z.ZodType) => schema.pipe(suppressionIdentifiers),
};

const suppressionSelect = createSelectSchema(suppression, suppressionRefinements);
const suppressionInsert = createInsertSchema(suppression, suppressionRefinements);
const suppressionUpdate = createUpdateSchema(suppression, suppressionRefinements);

const writeUpRefinements = {
  workspaceId,
  id: writeUpId,
  ...readableUnit,
};

const writeUpSelect = createSelectSchema(writeUp, writeUpRefinements);
const writeUpInsert = createInsertSchema(writeUp, writeUpRefinements);
const writeUpUpdate = createUpdateSchema(writeUp, writeUpRefinements);

const writeUpIncludeRefinements = {
  workspaceId,
  writeUpId,
  id: (schema: z.ZodString) => schema.trim().min(1),
  ordinal: (schema: z.ZodNumber) => schema.int().nonnegative(),
  iri: conceptIri,
};

const writeUpIncludeSelect = createSelectSchema(writeUpInclude, writeUpIncludeRefinements);
const writeUpIncludeInsert = createInsertSchema(writeUpInclude, writeUpIncludeRefinements);
const writeUpIncludeUpdate = createUpdateSchema(writeUpInclude, writeUpIncludeRefinements);

const recordConcept = z.strictObject({
  iri: CONCEPT_IRI,
  contentHash: z.string().regex(CONTENT_HASH),
  trust: z.strictObject({
    tier: z.string().trim().min(1),
    status: z.string().trim().min(1),
    verifiedAt: z.union([z.string().trim().min(1), z.null()]),
    rider: z.union([z.string().trim().min(1), z.null()]),
  }),
  judged: z.enum(CANDIDATE_VERDICTS).exactOptional(),
});

export type RecordConcept = z.output<typeof recordConcept>;

const questionAskedRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  askedBy: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  transport: (schema: z.ZodString) => schema.pipe(z.enum(QUESTION_TRANSPORTS)),
  collections: (schema: z.ZodArray<z.ZodString>) => z.array(schema.element.trim().min(1)),
  predicateRole: (schema: z.ZodString) => schema.pipe(z.enum(ROLES)),
  predicateGroups: (schema: z.ZodArray<z.ZodString>) => z.array(groupId(schema.element)),
  verdict: (schema: z.ZodString) => schema.pipe(z.enum(QUESTION_VERDICTS)),
  judgeState: (schema: z.ZodString) => schema.pipe(z.enum(JUDGE_STATES)),
  concepts: (schema: z.ZodType) => schema.pipe(z.array(recordConcept)),
  unmappedPassages: (schema: z.ZodArray<z.ZodString>) => z.array(schema.element.trim().min(1)),
};

const questionAskedSelect = createSelectSchema(questionAsked, questionAskedRefinements);
const questionAskedInsert = createInsertSchema(questionAsked, questionAskedRefinements);
const questionAskedUpdate = createUpdateSchema(questionAsked, questionAskedRefinements);

const draftedSentence = z.strictObject({
  sentence: z.string().trim().min(1),
  concepts: z.array(CONCEPT_IRI).min(1),
});

export type DraftedSentence = z.output<typeof draftedSentence>;

const questionContentRefinements = {
  workspaceId,
  recordId: (schema: z.ZodString) => schema.regex(ULID),
  question: (schema: z.ZodString) => schema.min(1),
  drafted: (schema: z.ZodType) => schema.pipe(z.union([z.array(draftedSentence), z.null()])),
};

const questionContentSelect = createSelectSchema(questionContent, questionContentRefinements);
const questionContentInsert = createInsertSchema(questionContent, questionContentRefinements);
const questionContentUpdate = createUpdateSchema(questionContent, questionContentRefinements);

const questionFeedbackRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  recordId: (schema: z.ZodString) => schema.regex(ULID),
  givenBy: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  verdict: (schema: z.ZodString) => schema.pipe(z.enum(FEEDBACK_VERDICTS)),
  reason: (schema: z.ZodString) => schema.pipe(z.enum(FEEDBACK_REASONS)),
  note: (schema: z.ZodString) => schema.trim().min(1),
  disputedSentence: (schema: z.ZodString) => schema.trim().min(1),
  disputedConcept: conceptIri,
  closedAs: (schema: z.ZodString) => schema.pipe(z.enum(FLAG_CLOSINGS)),
};

const questionFeedbackSelect = createSelectSchema(questionFeedback, questionFeedbackRefinements);
const questionFeedbackInsert = createInsertSchema(questionFeedback, questionFeedbackRefinements);
const questionFeedbackUpdate = createUpdateSchema(questionFeedback, questionFeedbackRefinements);

const mapLabel = (labels: readonly string[]) => (schema: z.ZodString) =>
  schema.refine(
    (label) =>
      labels.some((known) => known === label) || label.startsWith(SOURCE_ENTITY_LABEL_PREFIX),
    { message: "a map label is one of the closed set, or wears the source-entity prefix" },
  );

type MapRowInput = { readonly label: string; readonly gen?: number | null };

const sourceEntityCarriesNoGen = (row: MapRowInput): boolean =>
  !row.label.startsWith(SOURCE_ENTITY_LABEL_PREFIX) || row.gen === null || row.gen === undefined;

const closedNodeLabelCarriesGen = (row: MapRowInput): boolean =>
  row.label.startsWith(SOURCE_ENTITY_LABEL_PREFIX) || (row.gen !== null && row.gen !== undefined);

const generation = (schema: z.ZodNumber) => schema.int().positive();

const mapGenerationRefinements = {
  workspaceId,
  liveGen: generation,
};

const mapGenerationSelect = createSelectSchema(mapGeneration, mapGenerationRefinements);
const mapGenerationInsert = createInsertSchema(mapGeneration, mapGenerationRefinements);
const mapGenerationUpdate = createUpdateSchema(mapGeneration, mapGenerationRefinements);

const mapKey = (schema: z.ZodString) => schema.trim().min(1);

const mapRow = {
  workspaceId,
  gen: generation,
  uid: mapKey,
  ...readableUnit,
};

const mapNodeRefinements = {
  ...mapRow,
  label: mapLabel(MAP_NODE_LABELS),
  kind: mapKey,
};

const mapNodeSelect = createSelectSchema(mapNode, mapNodeRefinements);
const mapNodeInsert = createInsertSchema(mapNode, mapNodeRefinements)
  .refine(sourceEntityCarriesNoGen, {
    message: "a source-entity label carries no generation",
    path: ["gen"],
  })
  .refine(closedNodeLabelCarriesGen, {
    message: "a closed node label is a bundle-and-record row and carries its generation",
    path: ["gen"],
  });
const mapNodeUpdate = createUpdateSchema(mapNode, mapNodeRefinements);

const mapEdgeRefinements = {
  ...mapRow,
  label: mapLabel(MAP_EDGE_LABELS),
  fromUid: mapKey,
  toUid: mapKey,
  fromKind: mapKey,
  toKind: mapKey,
};

const mapEdgeSelect = createSelectSchema(mapEdge, mapEdgeRefinements);
const mapEdgeInsert = createInsertSchema(mapEdge, mapEdgeRefinements).refine(
  sourceEntityCarriesNoGen,
  { message: "a source-entity label carries no generation", path: ["gen"] },
);
const mapEdgeUpdate = createUpdateSchema(mapEdge, mapEdgeRefinements);

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

const jobSelect = createSelectSchema(job, jobRefinements);
const jobInsert = createInsertSchema(job, jobRefinements);
const jobUpdate = createUpdateSchema(job, jobRefinements);

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

const suggestionSelect = createSelectSchema(suggestion, suggestionRefinements);
const suggestionInsert = createInsertSchema(suggestion, suggestionRefinements);
const suggestionUpdate = createUpdateSchema(suggestion, suggestionRefinements);

const conceptWriteRequestRefinements = {
  workspaceId,
  suggestionId: (schema: z.ZodString) => schema.regex(ULID),
  mergeKey: (schema: z.ZodString) => schema.trim().min(1),
  ...conceptFileRefinements,
  conceptKind,

  body: (schema: z.ZodString) => schema.max(SUGGESTION_BODY_MAX),
  baseContentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
};

const conceptWriteRequestSelect = createSelectSchema(
  conceptWriteRequest,
  conceptWriteRequestRefinements,
);
const conceptWriteRequestInsert = createInsertSchema(
  conceptWriteRequest,
  conceptWriteRequestRefinements,
);
const conceptWriteRequestUpdate = createUpdateSchema(
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
  modelChoice: {
    table: modelChoice,
    select: modelChoiceSelect,
    insert: modelChoiceInsert,
    update: modelChoiceUpdate,
  },
  modelKey: {
    table: modelKey,
    select: modelKeySelect,
    insert: modelKeyInsert,
    update: modelKeyUpdate,
  },
  llmCall: {
    table: llmCall,
    select: llmCallSelect,
    insert: llmCallInsert,
    update: llmCallUpdate,
  },
  spendReservation: {
    table: spendReservation,
    select: spendReservationSelect,
    insert: spendReservationInsert,
    update: spendReservationUpdate,
  },
  modelPrice: {
    table: modelPrice,
    select: modelPriceSelect,
    insert: modelPriceInsert,
    update: modelPriceUpdate,
  },
  workspaceConfig: {
    table: workspaceConfig,
    select: workspaceConfigSelect,
    insert: workspaceConfigInsert,
    update: workspaceConfigUpdate,
  },
  passage: { table: passage, select: passageSelect, insert: passageInsert, update: passageUpdate },
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
  invitationEmailCounter: {
    table: invitationEmailCounter,
    select: invitationEmailCounterSelect,
    insert: invitationEmailCounterInsert,
    update: invitationEmailCounterUpdate,
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
  authenticator: plain(authenticator),
  passkey: plain(passkey),
  passkeyLastUse: plain(passkeyLastUse),
  recoveryCode: plain(recoveryCode),
  secondFactorThrottle: plain(secondFactorThrottle),
  workspaceLastActive: plain(workspaceLastActive),
  testWorkspaceMark: {
    table: testWorkspaceMark,
    select: testWorkspaceMarkSelect,
    insert: testWorkspaceMarkInsert,
    update: testWorkspaceMarkUpdate,
  },
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
  mapGeneration: {
    table: mapGeneration,
    select: mapGenerationSelect,
    insert: mapGenerationInsert,
    update: mapGenerationUpdate,
  },
  mapNode: {
    table: mapNode,
    select: mapNodeSelect,
    insert: mapNodeInsert,
    update: mapNodeUpdate,
  },
  mapEdge: {
    table: mapEdge,
    select: mapEdgeSelect,
    insert: mapEdgeInsert,
    update: mapEdgeUpdate,
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
  conceptSensitivityOverride: {
    table: conceptSensitivityOverride,
    select: conceptSensitivityOverrideSelect,
    insert: conceptSensitivityOverrideInsert,
    update: conceptSensitivityOverrideUpdate,
  },
  connectedSource: {
    table: connectedSource,
    select: connectedSourceSelect,
    insert: connectedSourceInsert,
    update: connectedSourceUpdate,
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
  writeUp: {
    table: writeUp,
    select: writeUpSelect,
    insert: writeUpInsert,
    update: writeUpUpdate,
  },
  writeUpInclude: {
    table: writeUpInclude,
    select: writeUpIncludeSelect,
    insert: writeUpIncludeInsert,
    update: writeUpIncludeUpdate,
  },
  questionAsked: {
    table: questionAsked,
    select: questionAskedSelect,
    insert: questionAskedInsert,
    update: questionAskedUpdate,
  },
  questionContent: {
    table: questionContent,
    select: questionContentSelect,
    insert: questionContentInsert,
    update: questionContentUpdate,
  },
  questionFeedback: {
    table: questionFeedback,
    select: questionFeedbackSelect,
    insert: questionFeedbackInsert,
    update: questionFeedbackUpdate,
  },
} as const;
