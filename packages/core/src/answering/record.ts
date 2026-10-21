import type {
  CandidateVerdict,
  ConceptIri,
  JudgeState,
  QuestionTransport,
  QuestionVerdict,
  RecordMapState,
} from "@better-answers/schema";

import type { Trust } from "../concepts/index.ts";
import { actorIdOf, attempt, ulid, type Result, type UserPrincipal } from "../kernel/index.ts";
import { settleSpend, type CallSpent } from "../llm/index.ts";
import type { Tx } from "../store/postgres/index.ts";

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
  readonly judged?: CandidateVerdict;
};

export type DraftedSentence = {
  readonly sentence: string;
  readonly concepts: readonly ConceptIri[];
};

const COMPLETED = `UPDATE question_asked
     SET completed_at = $3, verdict = $4, judge_state = $5, concepts = $6, unmapped_passages = $7,
         map_state = $8
   WHERE workspace_id = $1 AND id = $2 AND completed_at IS NULL
  RETURNING asked_at::text AS asked_at`;

const ITS_DRAFT = `UPDATE question_content SET drafted = $4
   WHERE workspace_id = $1 AND record_id = $2 AND asked_at = $3::timestamptz`;

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
  readonly map: RecordMapState;
  readonly drafted?: readonly DraftedSentence[];
  readonly settled?:
    | {
        readonly reservationId: string;
        readonly calls: readonly CallSpent[];
      }
    | undefined;
};

export const completeRecord = async (
  asker: UserPrincipal,
  tx: Tx,
  input: RecordCompletion,
): Promise<Result<void, Error>> =>
  attempt(async () => {
    if (input.settled !== undefined) {
      const settled = await settleSpend(asker, tx, { ...input.settled, now: input.completedAt });
      if (!settled.ok) throw settled.error;
    }
    const completed = await tx.query<{ asked_at: string }>(COMPLETED, [
      asker.workspaceId,
      input.recordId,
      input.completedAt,
      input.verdict,
      input.judgeState,
      JSON.stringify(input.concepts.map(asKept)),
      input.unmappedPassages.map((passage) => passage.locator),
      JSON.stringify(input.map),
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

const DRAFT_KEPT = `UPDATE question_content AS content SET drafted = $3
    FROM question_asked AS record
   WHERE record.workspace_id = $1 AND record.id = $2 AND record.completed_at IS NOT NULL
     AND content.workspace_id = record.workspace_id AND content.record_id = record.id
     AND content.asked_at = record.asked_at`;

export type DraftKeeping = {
  readonly recordId: string;
  readonly drafted: readonly DraftedSentence[];
  readonly settled: { readonly reservationId: string; readonly calls: readonly CallSpent[] };
  readonly now: Date;
};

/**
 * A record not completed, or not there, answers an error.
 */
export const keepDraft = async (
  asker: UserPrincipal,
  tx: Tx,
  input: DraftKeeping,
): Promise<Result<void, Error>> =>
  attempt(async () => {
    const settled = await settleSpend(asker, tx, { ...input.settled, now: input.now });
    if (!settled.ok) throw settled.error;
    const kept = await tx.query(DRAFT_KEPT, [
      asker.workspaceId,
      input.recordId,
      JSON.stringify(input.drafted),
    ]);
    if (kept.rowCount !== 1) {
      throw new Error(`answering: no completed record ${input.recordId} to keep a draft on`);
    }
  });
