import type pg from "pg";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { actorIdOfPerson } from "../../src/kernel/index.ts";
import { personIdOf } from "../support/platform.ts";
import { rowsFrom } from "../support/rows.ts";
import { seedingWith } from "../support/suite-postgres.ts";

const A_QUESTION_ASKED = "How long are audit logs kept?";

const A_NOTE_ON_A_FLAG = "The period changed in May.";

const A_DISPUTED_SENTENCE = "Audit logs are kept for a year.";

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

export const flagGivenBy = (
  pool: pg.Pool,
  workspaceId: string,
  recordId: string,
  personId: string,
) =>
  seedingWith(pool, (seed) =>
    seed.questionFeedback({
      workspaceId,
      recordId,
      givenBy: actorIdOfPerson(personIdOf(personId)),
      verdict: "flag",
      reason: "incomplete",
      note: A_NOTE_ON_A_FLAG,
    }),
  );

export const flagsOn = async (pool: pg.Pool, recordId: string) => {
  const read = await pool.query<{ given_by: string; note: string | null }>(
    `SELECT given_by, note FROM question_feedback
      WHERE record_id = $1 ORDER BY note NULLS FIRST, given_by`,
    [recordId],
  );
  return read.rows;
};

export const flagStanding = (givenBy: string) => ({ given_by: givenBy, note: A_NOTE_ON_A_FLAG });

export const askedAMicrosecondFiner = async (pool: pg.Pool, recordId: string): Promise<void> => {
  for (const [table, key] of [
    ["question_content", "record_id"],
    ["question_asked", "id"],
  ]) {
    await pool.query(
      `UPDATE ${table} SET asked_at = asked_at + interval '123 microseconds' WHERE ${key} = $1`,
      [recordId],
    );
  }
};

export const questionRowsOf = async (pool: pg.Pool, recordId: string) => {
  const read = async (statement: string) => rowsFrom(await pool.query(statement, [recordId]));
  return {
    skeleton: await read("SELECT asked_by, verdict FROM question_asked WHERE id = $1"),
    content: await read("SELECT question FROM question_content WHERE record_id = $1"),
    feedback: await read(
      `SELECT given_by, reason, note, disputed_sentence,
              disputed_concept IS NOT NULL AS rests_on_a_concept
         FROM question_feedback WHERE record_id = $1`,
    ),
  };
};

export const asAsked = (asker: string) => ({
  skeleton: [{ asked_by: asker, verdict: "related" }],
  content: [{ question: A_QUESTION_ASKED }],
  feedback: [
    {
      given_by: asker,
      reason: "wrong",
      note: A_NOTE_ON_A_FLAG,
      disputed_sentence: A_DISPUTED_SENTENCE,
      rests_on_a_concept: true,
    },
  ],
});

export const asErased = (pseudonym: string) => ({
  skeleton: [{ asked_by: `human:${pseudonym}`, verdict: "related" }],
  content: [],
  feedback: [
    {
      given_by: `human:${pseudonym}`,
      reason: "wrong",
      note: null,
      disputed_sentence: null,
      rests_on_a_concept: true,
    },
  ],
});
