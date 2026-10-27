import { z } from "zod";

import {
  bundleCommit,
  CONCEPT_BODY_MAX,
  CONCEPT_FRONTMATTER_MAX,
  CONCEPT_PATH,
  CONCEPT_STATUSES,
  COLLECTION,
  conceptOwner,
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
} from "../knowledge/concept-tables.ts";
import {
  conceptWriteRequest,
  suggestion,
  SUGGESTION_BODY_MAX,
  SUGGESTION_KINDS,
  SUGGESTION_REASON_MAX,
  SUGGESTION_STATUSES,
} from "../knowledge/suggestion-tables.ts";
import { ACTOR_ID as ACTOR_ID_REGEX } from "../people/actor-id.ts";
import { ULID } from "../ulid.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { workspaceId, readableUnit, conceptIri } from "./shared.ts";

const PROTO_FAMILY = /^_{2,}proto__$/u;
const ESCAPED_PROTO_FAMILY = /^_{3,}proto__$/u;
const PLAIN_PROTOTYPES: ReadonlySet<unknown> = new Set([Object.prototype, null]);

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
        PLAIN_PROTOTYPES.has(Object.getPrototypeOf(input))
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

const conceptOwnerRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  collection: (schema: z.ZodString) => schema.regex(COLLECTION),
  iri: conceptIri,
  personId: (schema: z.ZodString) => schema.regex(ULID),
};

const conceptOwnerSelect = createSelectSchema(conceptOwner, conceptOwnerRefinements);
const conceptOwnerInsert = createInsertSchema(conceptOwner, conceptOwnerRefinements);
const conceptOwnerUpdate = createUpdateSchema(conceptOwner, conceptOwnerRefinements);

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

export const conceptSchemas = {
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
  conceptOwner: {
    table: conceptOwner,
    select: conceptOwnerSelect,
    insert: conceptOwnerInsert,
    update: conceptOwnerUpdate,
  },
} as const;
