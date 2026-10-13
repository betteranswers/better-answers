import type pg from "pg";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { actorIdOfPerson } from "../src/kernel/index.ts";
import { personIdOf } from "./platform.ts";
import { seedingWith } from "./suite-postgres.ts";

const A_QUESTION_ASKED = "How long are audit logs kept?";

const A_NOTE_ON_A_FLAG = "The period changed in May.";

const A_DISPUTED_SENTENCE = "Audit logs are kept for a year.";

/** One completed record `personId` asked, with its question and a flag of theirs carrying a note. */
export const recordAskedBy = (pool: pg.Pool, workspaceId: string, personId: string) =>
  seedingWith(pool, async (seed) => {
    const asker = actorIdOfPerson(personIdOf(personId));
    const concept = conceptIriOf(ulid());
    const record = await seed.questionAsked({
      workspaceId,
      askedBy: asker,
      completedAt: new Date(),
      verdict: "related",
      judgeState: "not-judged",
      concepts: [
        {
          iri: concept,
          contentHash: "a".repeat(64),
          trust: { tier: "unverified", status: "current", verifiedAt: null, rider: null },
        },
      ],
    });
    await seed.questionContent({
      workspaceId,
      recordId: record.id,
      askedAt: record.askedAt,
      question: A_QUESTION_ASKED,
    });
    const flag = await seed.questionFeedback({
      workspaceId,
      recordId: record.id,
      givenBy: asker,
      verdict: "flag",
      reason: "wrong",
      note: A_NOTE_ON_A_FLAG,
      disputedSentence: A_DISPUTED_SENTENCE,
      disputedConcept: concept,
    });
    return { recordId: record.id, feedbackId: flag.id, asker, concept };
  });

/** What the three tables hold of one record, read past row-level security. */
export const questionRowsOf = async (pool: pg.Pool, recordId: string) => {
  const read = async (statement: string) => (await pool.query(statement, [recordId])).rows;
  return {
    skeleton: await read("SELECT asked_by, verdict FROM question_asked WHERE id = $1"),
    content: await read("SELECT question FROM question_content WHERE record_id = $1"),
    feedback: await read(
      `SELECT given_by, reason, note, disputed_sentence
         FROM question_feedback WHERE record_id = $1`,
    ),
  };
};

/** The rows `recordAskedBy` leaves, named by `asker`, with the question and the note in place. */
export const asAsked = (asker: string) => ({
  skeleton: [{ asked_by: asker, verdict: "related" }],
  content: [{ question: A_QUESTION_ASKED }],
  feedback: [
    {
      given_by: asker,
      reason: "wrong",
      note: A_NOTE_ON_A_FLAG,
      disputed_sentence: A_DISPUTED_SENTENCE,
    },
  ],
});

/** The same rows once an erasure has reached them: the skeleton and the flag stay, renamed. */
export const asErased = (pseudonym: string) => ({
  skeleton: [{ asked_by: `human:${pseudonym}`, verdict: "related" }],
  content: [],
  feedback: [
    {
      given_by: `human:${pseudonym}`,
      reason: "wrong",
      note: null,
      disputed_sentence: A_DISPUTED_SENTENCE,
    },
  ],
});
