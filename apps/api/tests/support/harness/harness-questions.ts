import { z } from "zod";

import { TRUST_TIERS } from "@better-answers/core/answering";
import { actorIdOfPerson } from "@better-answers/core/kernel";
import {
  boundarySchemas,
  CANDIDATE_VERDICTS,
  FEEDBACK_REASONS,
  FLAG_CLOSINGS,
  JUDGE_STATES,
  QUESTION_TRANSPORTS,
  QUESTION_VERDICTS,
  ulid,
} from "@better-answers/schema";
import { testData, type TestData } from "@better-answers/schema/testing";

import type { aStoppableClock } from "../suite-app.ts";
import { inOneTransaction } from "./harness-sources.ts";
import type { TestApp } from "./harness.ts";

const A_CONTENT_HASH = "a".repeat(64);

const aRecordedConcept = z.object({
  iri: z.string().min(1),
  tier: z.enum(TRUST_TIERS).default("unverified"),
  judged: z.enum(CANDIDATE_VERDICTS).optional(),
});

const aFlag = z.object({
  reason: z.enum(FEEDBACK_REASONS),
  note: z.string().min(1).nullable().default(null),
  disputedSentence: z.string().min(1).nullable().default(null),
  disputedConcept: z.string().min(1).nullable().default(null),
  closedAs: z.enum(FLAG_CLOSINGS).nullable().default(null),
});

const aDraftedSentence = z.object({
  sentence: z.string().min(1),
  concepts: z.array(z.string().min(1)).min(1),
});

const aRecord = z.object({
  askedBy: boundarySchemas.user.select.shape.id.optional(),
  transport: z.enum(QUESTION_TRANSPORTS).default("mcp"),
  collections: z.array(z.string().min(1)).default([]),
  question: z.string().min(1).nullable(),
  verdict: z.enum(QUESTION_VERDICTS),
  judgeState: z.enum(JUDGE_STATES).default("not-judged"),
  concepts: z.array(aRecordedConcept).default([]),
  drafted: z.array(aDraftedSentence).nullable().default(null),
  flags: z.array(aFlag).default([]),
});

export const questionsSeeding = z.object({
  workspaceId: z.string().min(1),
  records: z.array(aRecord).min(1),
});

type AskedRecord = z.output<typeof aRecord>;

type SeededRecord = { readonly recordId: string; readonly flagIds: readonly string[] };

const ONE_SECOND_MS = 1000;

const askerOf = (record: AskedRecord): string =>
  record.askedBy === undefined ? `human:${ulid()}` : actorIdOfPerson(record.askedBy);

const trustOf = (tier: (typeof TRUST_TIERS)[number], askedAt: Date) => ({
  tier,
  status: "current",
  verifiedAt: tier === "unverified" ? null : askedAt.toISOString(),
  rider: null,
});

const seedRecord = async (
  seed: TestData,
  workspaceId: string,
  record: AskedRecord,
  askedAt: Date,
): Promise<SeededRecord> => {
  const asker = askerOf(record);
  const row = await seed.questionAsked({
    workspaceId,
    askedAt,
    askedBy: asker,
    transport: record.transport,
    collections: record.collections,
    completedAt: askedAt,
    verdict: record.verdict,
    judgeState: record.judgeState,
    concepts: record.concepts.map(({ iri, tier, judged }) => ({
      iri,
      contentHash: A_CONTENT_HASH,
      trust: trustOf(tier, askedAt),
      ...(judged === undefined ? {} : { judged }),
    })),
  });
  if (record.question !== null) {
    await seed.questionContent({
      workspaceId,
      recordId: row.id,
      askedAt: row.askedAt,
      question: record.question,
      drafted: record.drafted,
    });
  }
  const flagIds: string[] = [];
  for (const flag of record.flags) {
    const given = await seed.questionFeedback({
      workspaceId,
      recordId: row.id,
      givenBy: asker,
      verdict: "flag",
      ...flag,
      closedAt: flag.closedAs === null ? null : askedAt,
    });
    flagIds.push(given.id);
  }
  return { recordId: row.id, flagIds };
};

export const seedQuestions = async (
  app: TestApp,
  asked: z.output<typeof questionsSeeding>,
): Promise<readonly SeededRecord[]> =>
  inOneTransaction(app, async (client) => {
    const seed = testData(client);
    const newest = Date.now();
    const seeded: SeededRecord[] = [];
    for (const [at, record] of asked.records.entries()) {
      const askedAt = new Date(newest - (asked.records.length - 1 - at) * ONE_SECOND_MS);
      seeded.push(await seedRecord(seed, asked.workspaceId, record, askedAt));
    }
    return seeded;
  });

export const recordsIn = async (app: TestApp, workspaceId: string) => {
  const kept = await app.database.superuser.query<Record<string, unknown>>(
    `SELECT r.transport, r.verdict, r.judge_state, r.completed_at IS NOT NULL AS completed, c.question
       FROM question_asked r JOIN question_content c ON c.record_id = r.id
      WHERE r.workspace_id = $1`,
    [workspaceId],
  );
  return kept.rows;
};

export const feedbackKeptOn = async (app: TestApp, recordId: string) => {
  const kept = await app.database.superuser.query<Record<string, unknown>>(
    `SELECT given_by, verdict, reason, note, disputed_sentence, disputed_concept
       FROM question_feedback WHERE record_id = $1 ORDER BY given_at, id`,
    [recordId],
  );
  return kept.rows;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const TWO_DAYS_MS = 2 * ONE_DAY_MS;

export const staleTomorrow = (): string =>
  new Date(Date.now() + ONE_DAY_MS).toISOString().slice(0, 10);

type MovedClock = Pick<ReturnType<typeof aStoppableClock>, "stopTheClock" | "moveTheClock">;

type RecordsRead = () => Promise<
  readonly { readonly concepts: readonly { readonly trustWords: string }[] }[]
>;

export const wordsTwoDaysApart = async (
  clock: MovedClock,
  read: RecordsRead,
): Promise<readonly (string | undefined)[]> => {
  const wordsNow = async () => (await read())[0]?.concepts[0]?.trustWords;
  clock.stopTheClock();
  const before = await wordsNow();
  clock.moveTheClock(TWO_DAYS_MS);
  return [before, await wordsNow()];
};
