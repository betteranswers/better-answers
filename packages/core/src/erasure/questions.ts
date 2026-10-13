import { PERSON_PREFIX, type PlatformPrincipal } from "../kernel/index.ts";
import { withScope, type PostgresDoor } from "../store/postgres/index.ts";
import { askersOf } from "./map.ts";

export type QuestionsSwept = {
  /** The records whose asker was rewritten; each keeps its skeleton. */
  readonly rewritten: number;
  readonly questionsRemoved: number;
  readonly feedbackRewritten: number;
};

const REWRITE_THE_ASKER = `UPDATE question_asked SET asked_by = $3
   WHERE workspace_id = $1 AND asked_by = ANY($2)
  RETURNING id`;

const REMOVE_THE_QUESTIONS =
  "DELETE FROM question_content WHERE workspace_id = $1 AND record_id = ANY($2)";

/** The reason and the disputed sentence stay: neither is the person's own words. */
const REWRITE_THE_FEEDBACK = `UPDATE question_feedback SET given_by = $3, note = NULL
   WHERE workspace_id = $1 AND given_by = ANY($2)`;

/**
 * Rewrites who asked and who gave feedback to the erasure pseudonym, deletes the questions and
 * clears the notes, in this workspace alone and in one transaction. The skeletons stay. Does
 * nothing where no person is named.
 */
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
  if (askers.length === 0) return { rewritten: 0, questionsRemoved: 0, feedbackRewritten: 0 };

  const erased = `${PERSON_PREFIX}${subject.pseudonym}`;
  return withScope(platform, door, subject.workspaceId, async (tx) => {
    const records = await tx.query<{ id: string }>(REWRITE_THE_ASKER, [
      subject.workspaceId,
      askers,
      erased,
    ]);
    const questions = await tx.query(REMOVE_THE_QUESTIONS, [
      subject.workspaceId,
      records.rows.map((row) => row.id),
    ]);
    const feedback = await tx.query(REWRITE_THE_FEEDBACK, [subject.workspaceId, askers, erased]);
    return {
      rewritten: records.rowCount ?? 0,
      questionsRemoved: questions.rowCount ?? 0,
      feedbackRewritten: feedback.rowCount ?? 0,
    };
  });
};
