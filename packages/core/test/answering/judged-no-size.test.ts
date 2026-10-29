import { assert, describe, expect, it } from "vitest";

import { conceptIriOf, WELL_FORMED_ULID } from "@better-answers/schema";

import { ASK_CAPS, type ReturnedConcept } from "../../src/answering/index.ts";
import { judgedBy } from "../../src/answering/judge.ts";
import type { AnswerPlan } from "../../src/answering/plan.ts";
import { ok } from "../../src/kernel/index.ts";
import { A_CANDIDATE, clientAnswering, judgeReplyTo } from "../support/judge-wire.ts";

const CLAUDE_CODE_INLINE_RESULT_CHARACTERS = 50_000;

const LARGE_ANSWER_CHARACTERS = 7_000;

const largeAnswer = (nth: number): ReturnedConcept => {
  const place = String(nth).padStart(4, "0");
  return {
    ...A_CANDIDATE,
    iri: conceptIriOf(WELL_FORMED_ULID.parse(`01J6AAAAAAAAAAAAAAAAAA${place}`)),
    url: `/knowledge/search/${place}`,
    title: `How do buyers export audit information, variant ${place}?`,
    body: `${"Audit information is exported from the console on request. ".repeat(
      Math.ceil(LARGE_ANSWER_CHARACTERS / 60),
    )}\n`,
  };
};

const MANY_LARGE_ANSWERS = Array.from({ length: ASK_CAPS.related }, (_, nth) => largeAnswer(nth));

const AN_UNJUDGED_PLAN: AnswerPlan = {
  answer: {
    verdict: "related",
    judgeState: "not-judged",
    answers: [],
    related: MANY_LARGE_ANSWERS,
    conflicts: [],
    unmappedPassages: [],
    map: { state: "live" },
    collections: ["audits"],
    readableCollections: ["audits"],
  },
  concepts: [],
};

describe("a judged-no result of many large `Answer`s", () => {
  it("stays under the inline limit, each `Answer` as one line", async () => {
    const wire = clientAnswering(async (body) => new Response(judgeReplyTo([], body)));
    const steps = {
      callModel: wire.client.callModel,
      decideYesNo: wire.client.decideYesNo,
      reserve: async () =>
        ok({
          reservationId: "01J6BBBBBBBBBBBBBBBBBBBBBB",
          to: {
            purpose: "judging" as const,
            modelChoiceId: "01J6CCCCCCCCCCCCCCCCCCCCCC",
            provider: "anthropic" as const,
            model: "claude-sonnet-5-5",
            key: { reveal: () => "sk-test-invented-key-0001" },
            threshold: undefined,
          },
        }),
    };
    const asked = {
      question: "How do buyers access audit information?",
      answerId: "a",
      now: new Date(),
    };
    expect(JSON.stringify(AN_UNJUDGED_PLAN.answer).length).toBeGreaterThan(
      CLAUDE_CODE_INLINE_RESULT_CHARACTERS,
    );

    const judged = await judgedBy(steps, AN_UNJUDGED_PLAN, asked, ASK_CAPS);

    assert(judged.ok, "the judge is reached");
    const { answer } = judged.value;
    expect([answer.verdict, answer.judgeState, answer.answers]).toEqual(["related", "judged", []]);
    expect(answer.related).toHaveLength(ASK_CAPS.related);
    expect(new Set(answer.related.flatMap((concept) => Object.keys(concept)))).toEqual(
      new Set(["iri", "url", "kind", "title", "collection", "trust", "trustWords"]),
    );
    expect(JSON.stringify(answer).length).toBeLessThan(CLAUDE_CODE_INLINE_RESULT_CHARACTERS);
  });
});
