import { z } from "zod";

import { boundarySchemas, FEEDBACK_REASONS, FEEDBACK_VERDICTS, IRI } from "@better-answers/schema";

import {
  actorIdOf,
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  MALFORMED,
  NOT_FOUND,
  ok,
  ulid,
  type Malformed,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { holdsNoNul } from "./boundary.ts";

const WRITTEN_CHARACTERS_AT_MOST = 2_000;

/** Kept as it was sent, apart from the space around it. */
const written = (what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(WRITTEN_CHARACTERS_AT_MOST)
    .refine(holdsNoNul, `${what} holds no NUL character`);

const recordId = boundarySchemas.questionAsked.select.shape.id;

const reason = z.enum(FEEDBACK_REASONS);

const note = written("a note");

const disputed = z.object({
  sentence: written("a disputed sentence").describe(
    "The sentence the person disputes, as you wrote it.",
  ),
  /** Read as text alone: it is compared with what the record kept, and stored. */
  concept: z
    .string()
    .regex(IRI)
    .describe("The `iri` of the concept that sentence rested on, one the answer returned."),
});

/** A transport's flat input: an MCP client takes no union at an input's root. */
export const feedbackFields = z.object({
  recordId: recordId.describe("The `recordId` the `ask` answer carried."),
  verdict: z.enum(FEEDBACK_VERDICTS).describe("Helpful, or a flag with a reason."),
  reason: reason.optional().describe("Required with a flag."),
  note: note.optional().describe("With a flag: what was wrong, in the person's own words."),
  disputed: disputed
    .optional()
    .describe(
      "With a flag on a sentence you wrote from the answer: that sentence and the concept it rested on.",
    ),
});

export const feedbackInput = z.discriminatedUnion("verdict", [
  z.object({ recordId, verdict: z.literal("helpful") }),
  z.object({
    recordId,
    verdict: z.literal("flag"),
    reason,
    note: note.optional(),
    disputed: disputed.optional(),
  }),
]);

export type FeedbackInput = z.output<typeof feedbackInput>;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export type FeedbackReceipt = {
  readonly outcome: "stored";
  readonly feedback: FeedbackInput;
};

const giveFeedbackAction = declareAction({
  admits: ANY_ROLE,
  input: feedbackInput,
  refuses: ["role-forbids", "not-found"],
});

/**
 * Row-level security shows a colleague's record too, so `asked_by` is what withholds it. `cites`
 * is true where no concept is named.
 */
const THE_GIVERS_RECORD = `SELECT ($4::jsonb IS NULL OR concepts @> $4::jsonb) AS cites
   FROM question_asked
  WHERE workspace_id = $1 AND id = $2 AND asked_by = $3 AND completed_at IS NOT NULL`;

const ITS_FEEDBACK = `INSERT INTO question_feedback
    (workspace_id, id, record_id, given_at, given_by, verdict, reason, note,
     disputed_sentence, disputed_concept)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

/** Answered only of the giver's own record, so it tells them nothing of anyone else's. */
const NOT_A_CONCEPT_IT_RETURNED: Malformed = {
  word: MALFORMED,
  fields: { "disputed.concept": "not-in-set" },
};

/** A flag's columns, each null on `helpful`. */
const columnsOf = (input: FeedbackInput) =>
  input.verdict === "helpful"
    ? { reason: null, note: null, sentence: null, concept: null }
    : {
        reason: input.reason,
        note: input.note ?? null,
        sentence: input.disputed?.sentence ?? null,
        concept: input.disputed?.concept ?? null,
      };

const storedOn = async (
  giver: UserPrincipal,
  tx: Tx,
  input: FeedbackInput,
  now: Date,
): Promise<Result<FeedbackReceipt, typeof NOT_FOUND | Malformed>> => {
  const flag = columnsOf(input);
  const found = await tx.query<{ cites: boolean }>(THE_GIVERS_RECORD, [
    giver.workspaceId,
    input.recordId,
    actorIdOf(giver),
    flag.concept === null ? null : JSON.stringify([{ iri: flag.concept }]),
  ]);
  const [record] = found.rows;
  if (record === undefined) return err(NOT_FOUND);
  if (!record.cites) return err(NOT_A_CONCEPT_IT_RETURNED);

  await tx.query(ITS_FEEDBACK, [
    giver.workspaceId,
    ulid(),
    input.recordId,
    now,
    actorIdOf(giver),
    input.verdict,
    flag.reason,
    flag.note,
    flag.sentence,
    flag.concept,
  ]);
  return ok({ outcome: "stored", feedback: input });
};

/**
 * Stores a verdict on a record its giver asked, once that record has a verdict of its own. A
 * record another person asked, and one left open, answer as a record that is not there. A
 * disputed concept must be one the record returned. Nothing is queued for anyone.
 */
export const giveFeedback = async (
  principal: UserPrincipal,
  tx: Tx,
  input: FeedbackInput,
  now: Date,
): Promise<Result<FeedbackReceipt, RefusalOf<typeof giveFeedbackAction> | Malformed | Error>> => {
  const admitted = admit(giveFeedbackAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const stored = await attempt(() => storedOn(admitted.value, tx, input, now));
  return stored.ok ? stored.value : err(stored.error);
};

const REASON_WORDS = {
  wrong: "wrong",
  "out-of-date": "out of date",
  incomplete: "incomplete",
  "should-not-have-shown": "should not have been shown",
} satisfies Record<FeedbackReason, string>;

const flagSaid = (flag: Extract<FeedbackInput, { readonly verdict: "flag" }>): string => {
  const noted = flag.note === undefined ? "" : ` — "${flag.note}"`;
  const disputing =
    flag.disputed === undefined ? "" : ", with the sentence disputed and the concept it rested on";
  return `flagged as ${REASON_WORDS[flag.reason]}${noted}${disputing}`;
};

/** Says where the feedback is kept and that it reaches nobody: all that is true of it. */
export const renderFeedback = ({ feedback }: FeedbackReceipt): string => {
  const what = feedback.verdict === "helpful" ? "marked helpful" : flagSaid(feedback);
  return `Stored on record ${feedback.recordId}: ${what}. No one is notified of it.`;
};
