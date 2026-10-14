import { z } from "zod";

import {
  boundarySchemas,
  FEEDBACK_FLAG_VERDICT,
  FLAG_CLOSINGS,
  type CandidateVerdict,
  type ConceptIri,
  type FlagClosing,
  type JudgeState,
  type QuestionTransport,
  type QuestionVerdict,
} from "@better-answers/schema";

import { action, declareActions, record } from "../audit/index.ts";
import { conceptsByIris, type OpenedConcept } from "../concepts/index.ts";
import {
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  NOT_FOUND,
  ok,
  ulid,
  type AdminUserPrincipal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { actorOf, namesOfPeople, peopleAmong, type AuditEventActor } from "../workspaces/index.ts";

const RECORD_ACTIONS = declareActions("knowledge", {
  flagClosed: action("knowledge.feedback.closed", { recordId: "id", closedAs: "flagClosing" }),
});

const QUESTIONS_ASKED_PAGE = 50;

const QUESTIONS_ASKED_PAGE_MOST = 100;

const recordId = boundarySchemas.questionAsked.select.shape.id;

export const questionsAskedInput = z.object({
  /** The last record of the page before; absent for the first page. */
  cursor: recordId.optional(),
  limit: z.number().int().min(1).max(QUESTIONS_ASKED_PAGE_MOST).default(QUESTIONS_ASKED_PAGE),
});

export type QuestionsAskedInput = z.output<typeof questionsAskedInput>;

const readQuestionsAskedAction = declareAction({
  admits: ADMIN_ALONE,
  input: questionsAskedInput,
  refuses: ["role-forbids"],
});

const skeleton = boundarySchemas.questionAsked.select;

type KeptConcept = NonNullable<z.output<typeof skeleton>["concepts"]>[number];

/** A concept a record cites, as the reader may read it now, with the trust it had then. */
export type ConceptAsRead = {
  readonly iri: ConceptIri;
  readonly kind: string;
  readonly title: string;
  /** Null for a concept in no collection. */
  readonly collection: string | null;
  readonly trustThen: KeptConcept["trust"];
  /** The judge's word on it; absent where no judge was asked. */
  readonly judged?: CandidateVerdict;
};

type DraftedSentence = { readonly sentence: string; readonly concepts: readonly ConceptIri[] };

export type FeedbackAsRead = {
  readonly id: string;
  readonly givenAt: string;
  readonly verdict: "helpful" | "flag";
  readonly reason: z.output<typeof boundarySchemas.questionFeedback.select>["reason"];
  readonly note: string | null;
  /** Given only where the reader may read the concept the sentence rested on. */
  readonly disputed?: { readonly sentence: string | null; readonly concept: ConceptIri };
  readonly closedAs: FlagClosing | null;
  readonly closedAt: string | null;
};

export type RecordAsRead = {
  readonly id: string;
  readonly askedAt: string;
  readonly askedBy: AuditEventActor;
  readonly transport: QuestionTransport;
  readonly collectionsNamed: readonly string[];
  /** Null once an erasure removed it. */
  readonly question: string | null;
  /** Null while the record is open. */
  readonly verdict: QuestionVerdict | null;
  readonly judgeState: JudgeState | null;
  /** It holds a flag no Admin has closed. */
  readonly flagged: boolean;
  readonly concepts: readonly ConceptAsRead[];
  /** Null unless the platform drafted; a sentence citing a concept the reader cannot read is left out. */
  readonly drafted: readonly DraftedSentence[] | null;
  readonly feedback: readonly FeedbackAsRead[];
  /** A refusal's group: the first readable matched concept's collection, null for none; absent otherwise. */
  readonly refusedUnder?: string | null;
};

export type QuestionsAskedPage = {
  readonly records: readonly RecordAsRead[];
  /** The last record's id when another page follows; null on the last page. */
  readonly nextCursor: string | null;
};

export type QuestionsAskedRefusal = RefusalOf<typeof readQuestionsAskedAction> | Error;

/** A record holds a flag while any flag on it is open. */
const OPEN_FLAG_ON = (record: string) => `EXISTS (
    SELECT 1 FROM question_feedback f
     WHERE f.workspace_id = ${record}.workspace_id AND f.record_id = ${record}.id
       AND f.verdict = '${FEEDBACK_FLAG_VERDICT}' AND f.closed_at IS NULL)`;

/** Flagged first, then newest; the cursor's place is read in SQL, never through a `Date`. */
const A_PAGE_OF_RECORDS = `SELECT q.id, q.asked_at AS "askedAt", q.asked_by AS "askedBy", q.transport,
         q.collections, q.verdict, q.judge_state AS "judgeState", q.concepts, c.question, c.drafted,
         ${OPEN_FLAG_ON("q")} AS flagged
    FROM question_asked q
    LEFT JOIN question_content c
           ON c.workspace_id = q.workspace_id AND c.record_id = q.id AND c.asked_at = q.asked_at
   WHERE q.workspace_id = $1
     AND ($2::text IS NULL OR (${OPEN_FLAG_ON("q")}, q.asked_at, q.id) < (
          SELECT ${OPEN_FLAG_ON("p")}, p.asked_at, p.id
            FROM question_asked p WHERE p.workspace_id = $1 AND p.id = $2))
   ORDER BY flagged DESC, q.asked_at DESC, q.id DESC
   LIMIT $3 + 1`;

const THEIR_FEEDBACK = `SELECT id, record_id AS "recordId", given_at AS "givenAt", verdict, reason,
         note, disputed_sentence AS "disputedSentence", disputed_concept AS "disputedConcept",
         closed_as AS "closedAs", closed_at AS "closedAt"
    FROM question_feedback
   WHERE workspace_id = $1 AND record_id = ANY($2::text[])
   ORDER BY given_at, id`;

const pageRow = skeleton
  .pick({
    id: true,
    askedAt: true,
    askedBy: true,
    transport: true,
    collections: true,
    verdict: true,
    judgeState: true,
    concepts: true,
  })
  .extend({
    question: boundarySchemas.questionContent.select.shape.question.nullable(),
    drafted: boundarySchemas.questionContent.select.shape.drafted.nullable(),
    flagged: z.boolean(),
  });

type PageRow = z.output<typeof pageRow>;

const feedbackRow = boundarySchemas.questionFeedback.select.pick({
  id: true,
  recordId: true,
  givenAt: true,
  verdict: true,
  reason: true,
  note: true,
  disputedSentence: true,
  disputedConcept: true,
  closedAs: true,
  closedAt: true,
});

type FeedbackRow = z.output<typeof feedbackRow>;

type Readable = ReadonlyMap<string, OpenedConcept>;

/** Every concept a page names anywhere, so each is read once under the reader's predicate. */
const irisNamedIn = (rows: readonly PageRow[], feedback: readonly FeedbackRow[]): ConceptIri[] => [
  ...new Set([
    ...rows.flatMap((row) => (row.concepts ?? []).map((concept) => concept.iri)),
    ...rows.flatMap((row) => (row.drafted ?? []).flatMap((sentence) => sentence.concepts)),
    ...feedback.flatMap((given) => (given.disputedConcept === null ? [] : [given.disputedConcept])),
  ]),
];

const conceptAsRead = (kept: KeptConcept, readable: Readable): readonly ConceptAsRead[] => {
  const now = readable.get(kept.iri);
  if (now === undefined) return [];
  const read = {
    iri: kept.iri,
    kind: now.kind,
    title: now.title,
    collection: now.collection,
    trustThen: kept.trust,
  };
  return [kept.judged === undefined ? read : { ...read, judged: kept.judged }];
};

const draftedAsRead = (
  drafted: PageRow["drafted"],
  readable: Readable,
): readonly DraftedSentence[] | null =>
  drafted === null
    ? null
    : drafted.filter((sentence) => sentence.concepts.every((iri) => readable.has(iri)));

const disputedAsRead = (given: FeedbackRow, readable: Readable) =>
  given.disputedConcept === null || !readable.has(given.disputedConcept)
    ? {}
    : { disputed: { sentence: given.disputedSentence, concept: given.disputedConcept } };

const feedbackAsRead = (given: FeedbackRow, readable: Readable): FeedbackAsRead => ({
  id: given.id,
  givenAt: given.givenAt.toISOString(),
  verdict: given.verdict,
  reason: given.reason,
  note: given.note,
  ...disputedAsRead(given, readable),
  closedAs: given.closedAs,
  closedAt: given.closedAt?.toISOString() ?? null,
});

const refusalGroup = (row: PageRow, concepts: readonly ConceptAsRead[]) =>
  row.verdict === "refuse" ? { refusedUnder: concepts[0]?.collection ?? null } : {};

type Read = {
  readonly readable: Readable;
  readonly feedback: ReadonlyMap<string, readonly FeedbackRow[]>;
  readonly askers: Awaited<ReturnType<typeof namesOfPeople>>;
};

const recordAsRead = (row: PageRow, read: Read): RecordAsRead => {
  const concepts = (row.concepts ?? []).flatMap((kept) => conceptAsRead(kept, read.readable));
  return {
    id: row.id,
    askedAt: row.askedAt.toISOString(),
    askedBy: actorOf(row.askedBy, read.askers),
    transport: row.transport,
    collectionsNamed: row.collections,
    question: row.question,
    verdict: row.verdict,
    judgeState: row.judgeState,
    flagged: row.flagged,
    concepts,
    drafted: draftedAsRead(row.drafted, read.readable),
    feedback: (read.feedback.get(row.id) ?? []).map((given) =>
      feedbackAsRead(given, read.readable),
    ),
    ...refusalGroup(row, concepts),
  };
};

const byRecord = (feedback: readonly FeedbackRow[]): ReadonlyMap<string, readonly FeedbackRow[]> =>
  Map.groupBy(feedback, (given) => given.recordId);

const readOf = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  rows: readonly PageRow[],
): Promise<Result<Read, QuestionsAskedRefusal>> => {
  const ids = rows.map((row) => row.id);
  const feedback = await attempt(async () =>
    (await tx.query(THEIR_FEEDBACK, [admin.workspaceId, ids])).rows.map((row) =>
      feedbackRow.parse(row),
    ),
  );
  if (!feedback.ok) return err(feedback.error);
  const iris = irisNamedIn(rows, feedback.value);
  const concepts = iris.length === 0 ? ok([]) : await conceptsByIris(admin, tx, iris);
  if (!concepts.ok) return err(concepts.error);
  const askers = await attempt(() =>
    namesOfPeople(tx, peopleAmong(rows.map((row) => row.askedBy))),
  );
  if (!askers.ok) return err(askers.error);
  return ok({
    readable: new Map(concepts.value.map((concept) => [concept.iri, concept])),
    feedback: byRecord(feedback.value),
    askers: askers.value,
  });
};

/**
 * Every record for an Admin, a page at a time, open flags first, then newest. Each concept is read
 * under the Admin's predicate now: one they cannot read is absent with no sign, as is a drafted or
 * disputed sentence resting on it.
 */
export const readQuestionsAsked = async (
  principal: UserPrincipal,
  tx: Tx,
  input: QuestionsAskedInput,
): Promise<Result<QuestionsAskedPage, QuestionsAskedRefusal>> => {
  const admitted = admit(readQuestionsAskedAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const admin = admitted.value;

  const asked = [admin.workspaceId, input.cursor ?? null, input.limit];
  const page = await attempt(async () =>
    (await tx.query(A_PAGE_OF_RECORDS, asked)).rows.map((row) => pageRow.parse(row)),
  );
  if (!page.ok) return err(page.error);
  const rows = page.value.slice(0, input.limit);
  const read = await readOf(admin, tx, rows);
  if (!read.ok) return err(read.error);
  return ok({
    records: rows.map((row) => recordAsRead(row, read.value)),
    nextCursor: page.value.length > input.limit ? (rows.at(-1)?.id ?? null) : null,
  });
};

export const closeFlagInput = z.object({
  feedbackId: boundarySchemas.questionFeedback.select.shape.id,
  closedAs: z.enum(FLAG_CLOSINGS),
});

export type CloseFlagInput = z.output<typeof closeFlagInput>;

const closeFlagAction = declareAction({
  admits: ADMIN_ALONE,
  input: closeFlagInput,
  refuses: ["role-forbids", "not-found", "already-decided"],
});

export type CloseFlagRefusal = RefusalOf<typeof closeFlagAction> | Error;

export type FlagClosed = {
  readonly feedbackId: string;
  readonly recordId: string;
  readonly closedAs: FlagClosing;
};

/** Helpful feedback is never a flag, so it answers as one that is not there. */
const THE_FLAG = `SELECT record_id, closed_at IS NOT NULL AS closed
    FROM question_feedback
   WHERE workspace_id = $1 AND id = $2 AND verdict = '${FEEDBACK_FLAG_VERDICT}'
     FOR UPDATE`;

const ITS_CLOSING = `UPDATE question_feedback SET closed_as = $3, closed_at = $4
   WHERE workspace_id = $1 AND id = $2 AND closed_at IS NULL
  RETURNING id`;

/**
 * Closes an open flag once, as fixed in the knowledge or as no fault in the knowledge, and audits
 * it in the same transaction. The row keeps how and when; who is the audit event's actor alone.
 */
export const closeFlag = async (
  principal: UserPrincipal,
  tx: Tx,
  input: CloseFlagInput,
  now: Date,
): Promise<Result<FlagClosed, CloseFlagRefusal>> => {
  const admitted = admit(closeFlagAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const admin = admitted.value;
  const { feedbackId, closedAs } = input;

  const found = await attempt(() =>
    tx.query<{ record_id: string; closed: boolean }>(THE_FLAG, [admin.workspaceId, feedbackId]),
  );
  if (!found.ok) return err(found.error);
  const flag = found.value.rows[0];
  if (flag === undefined) return err(NOT_FOUND);
  if (flag.closed) return err("already-decided");

  await record(admin, tx, {
    id: ulid(),
    action: RECORD_ACTIONS.flagClosed,
    subjectId: feedbackId,
    detail: { recordId: flag.record_id, closedAs },
  });
  const closed = await attempt(() =>
    tx.query(ITS_CLOSING, [admin.workspaceId, feedbackId, closedAs, now]),
  );
  if (!closed.ok) return err(closed.error);
  if (closed.value.rows.length === 0) {
    return err(new Error("the flag moved under the lock that was holding it"));
  }
  return ok({ feedbackId, recordId: flag.record_id, closedAs });
};
