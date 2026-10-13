import type {
  CandidateVerdict,
  ConceptIri,
  JudgeState,
  QuestionTransport,
  QuestionVerdict,
} from "@better-answers/schema";

import type { Trust } from "../concepts/index.ts";
import { actorIdOf, attempt, ulid, type Result, type UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/** One statement, so the content's month is its record's own `asked_at`. */
const A_RECORD_WITH_ITS_QUESTION = `WITH record AS (
    INSERT INTO question_asked
      (workspace_id, id, asked_at, asked_by, transport, collections, predicate_role,
       predicate_groups)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING workspace_id, id, asked_at
  )
  INSERT INTO question_content (workspace_id, record_id, asked_at, question)
  SELECT workspace_id, id, asked_at, $9::text FROM record`;

export type RecordOpening = {
  readonly question: string;
  readonly collections: readonly string[];
  readonly transport: QuestionTransport;
  readonly askedAt: Date;
};

/**
 * Writes the skeleton and the question in the caller's transaction, which the caller commits
 * before anything that can refuse the question. Answers an error where `askedAt` falls in a month
 * no sweep has made a partition for.
 */
export const openRecord = async (
  asker: UserPrincipal,
  tx: Tx,
  input: RecordOpening,
): Promise<Result<{ readonly recordId: string }, Error>> =>
  attempt(async () => {
    const recordId = ulid();
    await tx.query(A_RECORD_WITH_ITS_QUESTION, [
      asker.workspaceId,
      recordId,
      input.askedAt,
      actorIdOf(asker),
      input.transport,
      [...input.collections],
      asker.role,
      [...asker.groups],
      input.question,
    ]);
    return { recordId };
  });

export type RecordedConcept = {
  readonly iri: ConceptIri;
  readonly contentHash: string;
  readonly trust: Trust;
  /** The judge's word on a candidate; absent for a concept no judge was asked about. */
  readonly judged?: CandidateVerdict;
};

type DraftedSentence = {
  readonly sentence: string;
  readonly concepts: readonly ConceptIri[];
};

const COMPLETED = `UPDATE question_asked
     SET completed_at = $3, verdict = $4, judge_state = $5, concepts = $6, unmapped_passages = $7
   WHERE workspace_id = $1 AND id = $2 AND completed_at IS NULL
  RETURNING asked_at::text AS asked_at`;

/** `asked_at` as the text Postgres gave: a `Date` keeps milliseconds and would miss the row. */
const ITS_DRAFT = `UPDATE question_content SET drafted = $4
   WHERE workspace_id = $1 AND record_id = $2 AND asked_at = $3::timestamptz`;

/** Who verified a concept is a person and a record is kept for good, so the name is left out. */
const asKept = ({ iri, contentHash, trust, judged }: RecordedConcept) => ({
  iri,
  contentHash,
  trust: {
    tier: trust.tier,
    status: trust.status,
    verifiedAt: trust.verifiedAt,
    rider: trust.rider,
  },
  judged,
});

export type RecordCompletion = {
  readonly recordId: string;
  readonly completedAt: Date;
  readonly verdict: QuestionVerdict;
  readonly judgeState: JudgeState;
  readonly concepts: readonly RecordedConcept[];
  readonly unmappedPassages: readonly { readonly locator: string }[];
  /** Given only when the platform drafted. */
  readonly drafted?: readonly DraftedSentence[];
};

/**
 * Completes an open record once: a record already completed, or one that is not there, answers
 * an error and changes nothing. An unmapped passage is kept as its locator alone, and a concept
 * as its IRI, hash and trust, never its text.
 */
export const completeRecord = async (
  asker: UserPrincipal,
  tx: Tx,
  input: RecordCompletion,
): Promise<Result<void, Error>> =>
  attempt(async () => {
    const completed = await tx.query<{ asked_at: string }>(COMPLETED, [
      asker.workspaceId,
      input.recordId,
      input.completedAt,
      input.verdict,
      input.judgeState,
      JSON.stringify(input.concepts.map(asKept)),
      input.unmappedPassages.map((passage) => passage.locator),
    ]);
    const [record] = completed.rows;
    if (record === undefined) {
      throw new Error(`answering: no open record ${input.recordId} to complete`);
    }
    if (input.drafted === undefined) return;
    await tx.query(ITS_DRAFT, [
      asker.workspaceId,
      input.recordId,
      record.asked_at,
      JSON.stringify(input.drafted),
    ]);
  });
