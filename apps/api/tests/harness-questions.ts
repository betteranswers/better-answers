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

import { inOneTransaction } from "./harness-sources.ts";
import type { TestApp } from "./harness.ts";

/** Kept by the record as its trust then; the hash is never shown, so one stands for any. */
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
  /** A person's id; left out, the asker is one an erasure renamed, whom no name is found for. */
  askedBy: boundarySchemas.user.select.shape.id.optional(),
  transport: z.enum(QUESTION_TRANSPORTS).default("mcp"),
  collections: z.array(z.string().min(1)).default([]),
  /** Null once an erasure removed the record's content. */
  question: z.string().min(1).nullable(),
  verdict: z.enum(QUESTION_VERDICTS),
  judgeState: z.enum(JUDGE_STATES).default("not-judged"),
  concepts: z.array(aRecordedConcept).default([]),
  drafted: z.array(aDraftedSentence).nullable().default(null),
  flags: z.array(aFlag).default([]),
});

/** Listed oldest first: each is asked a second after the one before it, the last the newest. */
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

/** Records as `ask` and `give_feedback` leave them, in one transaction; a concept is named by IRI alone. */
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
