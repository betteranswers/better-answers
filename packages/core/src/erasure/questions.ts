import { PERSON_PREFIX, type PlatformPrincipal } from "../kernel/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";

export type QuestionsSwept = {
  /** The records whose asker was rewritten; each keeps its skeleton. */
  readonly rewritten: number;
  readonly questionsRemoved: number;
  readonly feedbackRewritten: number;
};

/** The actor ids a record may name the person by, given each as an actor id or a person id. */
export const askersOf = (people: readonly (string | null)[]): readonly string[] => [
  ...new Set(
    people
      .filter((person) => person !== null)
      .map((person) => (person.startsWith(PERSON_PREFIX) ? person : `${PERSON_PREFIX}${person}`)),
  ),
];

/** `asked_at` as text: a `Date` keeps milliseconds, and the delete must match the instant stored. */
const REWRITE_THE_ASKER = `UPDATE question_asked SET asked_by = $3
   WHERE workspace_id = $1 AND asked_by = ANY($2)
  RETURNING id, asked_at::text AS asked_at`;

/** Named by `asked_at` too, so only the months those records were asked in are read. */
const REMOVE_THE_QUESTIONS = `DELETE FROM question_content
   WHERE workspace_id = $1 AND record_id = ANY($2) AND asked_at = ANY($3::timestamptz[])`;

/**
 * The note and the disputed sentence go, as free text sent on the person's behalf. The reason and
 * the concept the sentence rested on stay.
 */
const REWRITE_THE_FEEDBACK = `UPDATE question_feedback
     SET given_by = $3, note = NULL, disputed_sentence = NULL
   WHERE workspace_id = $1 AND given_by = ANY($2)`;

export const NO_QUESTIONS_SWEPT: QuestionsSwept = {
  rewritten: 0,
  questionsRemoved: 0,
  feedbackRewritten: 0,
};

export const sweepTheQuestions = async (
  tx: Tx,
  subject: {
    readonly workspaceId: string;
    readonly askers: readonly string[];
    readonly pseudonym: string;
  },
): Promise<QuestionsSwept> => {
  const { workspaceId, askers } = subject;
  const erased = `${PERSON_PREFIX}${subject.pseudonym}`;
  const records = await tx.query<{ id: string; asked_at: string }>(REWRITE_THE_ASKER, [
    workspaceId,
    askers,
    erased,
  ]);
  const questions =
    records.rows.length === 0
      ? { rowCount: 0 }
      : await tx.query(REMOVE_THE_QUESTIONS, [
          workspaceId,
          records.rows.map((row) => row.id),
          records.rows.map((row) => row.asked_at),
        ]);
  const feedback = await tx.query(REWRITE_THE_FEEDBACK, [workspaceId, askers, erased]);
  return {
    rewritten: records.rowCount ?? 0,
    questionsRemoved: questions.rowCount ?? 0,
    feedbackRewritten: feedback.rowCount ?? 0,
  };
};

export const eraseFromTheQuestions = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  subject: {
    readonly workspaceId: string;
    readonly personIds: readonly (string | null)[];
    readonly pseudonym: string;
  },
): Promise<QuestionsSwept> => {
  const askers = askersOf(subject.personIds);
  if (askers.length === 0) return NO_QUESTIONS_SWEPT;

  return withScope(platform, door, subject.workspaceId, (tx) =>
    sweepTheQuestions(tx, {
      workspaceId: subject.workspaceId,
      askers,
      pseudonym: subject.pseudonym,
    }),
  );
};
