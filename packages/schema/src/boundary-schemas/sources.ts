import { z } from "zod";

import { CONTENT_HASH } from "../knowledge/concept-tables.ts";
import { SENSITIVITIES } from "../knowledge/readable-columns.ts";
import { ACTOR_ID as ACTOR_ID_REGEX } from "../people/actor-id.ts";
import {
  erasureRequest,
  type SUBJECT_IDENTIFIER_KINDS,
  SUBJECT_IDENTIFIER_MAX,
  SUBJECT_IDENTIFIERS_MAX,
  SUBJECT_REQUEST_KINDS,
  subjectRequest,
  suppression,
  SUPPRESSION_SIGN_IN_ADDRESSES_MAX,
} from "../sources/erasure-tables.ts";
import {
  finding,
  FINDING_REASON_MAX,
  FINDING_REVIEW_STATES,
  REDACTION_TIERS,
} from "../sources/finding-tables.ts";
import { passage, EMBEDDING_DIMENSIONS } from "../sources/index-tables.ts";
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
} from "../sources/source-tables.ts";
import { ULID } from "../ulid.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { workspaceId, readableUnit } from "./shared.ts";

const connectedSourceId = (schema: z.ZodString) => schema.regex(ULID).brand<"ConnectedSourceId">();

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

export const sourceSchemas = {
  passage: { table: passage, select: passageSelect, insert: passageInsert, update: passageUpdate },
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
} as const;
