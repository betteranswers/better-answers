import type { ConceptIri } from "@better-answers/schema";

import { readConcept } from "../concepts/index.ts";
import {
  admit,
  ANY_ROLE,
  declareAction,
  err,
  NOT_FOUND,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { parseLocator, passageAt } from "../sources/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { askInput, openInput, passageViewOf, type AskInput, type OpenInput } from "./boundary.ts";
import { judgedBy, type JudgeRefusal, type JudgeSteps } from "./judge.ts";
import {
  answerPlanned,
  ASK_CAPS,
  type AskCaps,
  type PlannedAnswer,
  type ReadStep,
} from "./plan.ts";
import type { RecordCompletion, RecordOpening } from "./record.ts";
import type { OpenResult, AnswerResult } from "./results.ts";

export { NOT_COMPANY_KNOWLEDGE } from "./results.ts";
export type { FindMatch, FindResult, OpenView, OpenResult, AnswerResult } from "./results.ts";
export { find } from "./find.ts";
export { renderFind, renderOpen, mapWords, renderAnswer } from "./render.ts";

export {
  answerOutputWith,
  askInput,
  findInput,
  findOutputWith,
  openInput,
  openOutputWith,
  type AskInput,
  type OpenInput,
} from "./boundary.ts";
export { findCursor, type FindPosition } from "./cursor.ts";
export {
  ASK_CAPS,
  type AskCaps,
  type PlannedAnswer,
  type PreviewedConcept,
  type ReadStep,
  type RelatedConcept,
  type ReturnedConcept,
} from "./plan.ts";
export { completeRecord, keepDraft, openRecord } from "./record.ts";
export {
  decisionJudgeCall,
  judgeCall,
  reserveDrafting,
  reserveJudge,
  type JudgeRefusal,
} from "./judge.ts";
export { draftAnswer, type DraftEvent, type DraftSteps } from "./draft.ts";
export {
  closeFlag,
  closeFlagInput,
  questionsAskedInput,
  readQuestionsAsked,
  readYourQuestions,
  readYourRecord,
  yourQuestionsInput,
  yourRecordInput,
  type QuestionsAskedInput,
  type YourQuestionsInput,
} from "./records.ts";
export {
  ANSWER_MEASURES,
  unmappedPassageRate,
  type UnmappedPassageRate,
} from "./unmapped-passage-rate.ts";

export {
  TRUST_RIDERS,
  TRUST_STATUSES,
  TRUST_TIERS,
  UNREVIEWED_TIERS,
  trustWords,
  type Trust,
  type TrustStatus,
} from "../concepts/index.ts";

export type { FrontmatterValue } from "../concepts/index.ts";

export { FEEDBACK_REASONS, FEEDBACK_VERDICTS } from "@better-answers/schema";
export {
  feedbackFields,
  feedbackInput,
  giveFeedback,
  renderFeedback,
  type FeedbackReason,
  type FeedbackReceipt,
} from "./feedback.ts";

const openAction = declareAction({
  admits: ANY_ROLE,
  input: openInput,
  refuses: ["role-forbids"],
});

export type OpenRefusal = RefusalOf<typeof openAction> | Error;

const passageOpened = async (
  reader: UserPrincipal,
  tx: Tx,
  asked: string,
): Promise<Result<OpenResult>> => {
  const passage = await passageAt(reader, tx, asked);
  if (!passage.ok) {
    return passage.error === NOT_FOUND ? ok({ found: false, locator: asked }) : err(passage.error);
  }
  return ok({ found: true, passage: passageViewOf(passage.value) });
};

const conceptOpened = async (
  reader: UserPrincipal,
  tx: Tx,
  named: ConceptIri,
  now: Date,
): Promise<Result<OpenResult>> => {
  const concept = await readConcept(reader, tx, named, {
    passageAt: (locator) => passageAt(reader, tx, locator),
    namesPassage: (locator) => parseLocator(locator).ok,
    now,
  });
  if (!concept.ok) return err(concept.error);
  if (concept.value === undefined) return ok({ found: false, iri: named });

  const {
    iri,
    frontmatter,
    body,
    relations,
    bodyLinks,
    trust,
    trustWords: words,
    pane,
  } = concept.value;
  return ok({
    found: true,
    concept: {
      iri,
      frontmatter,
      body,
      relations,
      bodyLinks,
      trust,
      trustWords: words,
      evidence: pane.evidence,
      access: pane.access,
      lead: pane.lead,
      next: pane.next,
    },
  });
};

/** A concept or passage that is not there answers `found: false`, not an error. */
export const open = async (
  principal: UserPrincipal,
  tx: Tx,
  input: OpenInput,
  now: Date,
): Promise<Result<OpenResult, OpenRefusal>> => {
  const admitted = admit(openAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  return input.iri === undefined
    ? passageOpened(admitted.value, tx, input.locator)
    : conceptOpened(admitted.value, tx, input.iri, now);
};

const askAction = declareAction({
  admits: ANY_ROLE,
  input: askInput,
  refuses: ["role-forbids"],
});

export type AskRefusal = RefusalOf<typeof askAction> | Error;

/**
 * Each runs in a transaction of its own, so none stays open across the judge's call.
 */
export type AskSteps<Refused = never> = JudgeSteps<Refused> & {
  readonly openRecord: (
    opening: Omit<RecordOpening, "transport">,
  ) => Promise<Result<{ readonly recordId: string }, Refused | Error>>;
  readonly read: ReadStep<Refused>;
  readonly completeRecord: (
    completion: Omit<RecordCompletion, "completedAt" | "drafted">,
  ) => Promise<Result<void, Refused | Error>>;
};

export const planAnswer = async <Refused = never>(
  principal: UserPrincipal,
  read: ReadStep<Refused>,
  input: AskInput,
  now: Date,
  caps: AskCaps = ASK_CAPS,
): Promise<Result<PlannedAnswer, AskRefusal | Refused>> => {
  const admitted = admit(askAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const plan = await answerPlanned(admitted.value, read, input, now, caps);
  return plan.ok ? ok(plan.value.answer) : plan;
};

/**
 * With no judge to call, every `Answer` is related knowledge. At the spending limit it refuses,
 * leaving the record open.
 */
export const ask = async <Refused = never>(
  principal: UserPrincipal,
  steps: AskSteps<Refused>,
  input: AskInput,
  now: Date,
  caps: AskCaps = ASK_CAPS,
): Promise<Result<AnswerResult, AskRefusal | JudgeRefusal | Refused>> => {
  const admitted = admit(askAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const { question, collections } = input;
  const opened = await steps.openRecord({ question, collections, askedAt: now });
  if (!opened.ok) return opened;
  const { recordId } = opened.value;
  const plan = await answerPlanned(admitted.value, steps.read, input, now, caps);
  if (!plan.ok) return plan;
  const judged = await judgedBy(steps, plan.value, { question, answerId: recordId, now }, caps);
  if (!judged.ok) return judged;
  const { answer, concepts, settled } = judged.value;
  const completed = await steps.completeRecord({
    recordId,
    verdict: answer.verdict,
    judgeState: answer.judgeState,
    concepts,
    unmappedPassages: answer.unmappedPassages,
    map: answer.map,
    settled,
  });
  if (!completed.ok) return completed;
  return ok({ ...answer, recordId });
};
