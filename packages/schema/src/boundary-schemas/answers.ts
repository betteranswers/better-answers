import { z } from "zod";

import { CONCEPT_IRI, CONTENT_HASH } from "../knowledge/concept-tables.ts";
import {
  CANDIDATE_VERDICTS,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  FLAG_CLOSINGS,
  JUDGE_STATES,
  MAP_LIVE,
  MAP_UNAVAILABLE,
  QUESTION_TRANSPORTS,
  QUESTION_VERDICTS,
  questionAsked,
  questionContent,
  questionFeedback,
} from "../knowledge/question-tables.ts";
import { usage, USAGE_ACTS } from "../knowledge/usage-tables.ts";
import { ACTOR_ID as ACTOR_ID_REGEX } from "../people/actor-id.ts";
import { ROLES } from "../people/roles.ts";
import { ULID } from "../ulid.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { workspaceId, groupId, writeUpId, conceptIri } from "./shared.ts";

const usageRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  act: (schema: z.ZodString) => schema.pipe(z.enum(USAGE_ACTS)),
  writeUpId,
  writeUpVersion: (schema: z.ZodNumber) => schema.int().positive(),
  iri: conceptIri,
};

const usageSelect = createSelectSchema(usage, usageRefinements);
const usageInsert = createInsertSchema(usage, usageRefinements);
const usageUpdate = createUpdateSchema(usage, usageRefinements);

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

export const recordMapState = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal(MAP_LIVE) }),
  z.strictObject({ state: z.literal(MAP_UNAVAILABLE), since: z.string() }),
]);

export type RecordMapState = z.output<typeof recordMapState>;

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
  mapState: (schema: z.ZodType) => schema.pipe(recordMapState),
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

export const answerSchemas = {
  usage: {
    table: usage,
    select: usageSelect,
    insert: usageInsert,
    update: usageUpdate,
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
