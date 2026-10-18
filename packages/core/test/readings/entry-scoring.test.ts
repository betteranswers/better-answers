import { describe, expect, it } from "vitest";

import type { DecisionModelCall } from "../../src/llm/index.ts";
import {
  readEntryScoring,
  reranked,
  scoringCall,
  type EntryPoint,
  type EntryScoringDoors,
} from "./entry-scoring.ts";

const ENTRIES: readonly EntryPoint[] = [
  { iri: "iri:first", title: "First?", body: "The first.\n" },
  { iri: "iri:second", title: "Second?" },
  { iri: "iri:third", title: "Third?", body: "The third." },
];

const LANDED = new Map([
  ["first", "iri:first"],
  ["second", "iri:second"],
  ["third", "iri:third"],
]);

const decidingBy =
  (yes: ReadonlyMap<string, number>): EntryScoringDoors["decide"] =>
  async (call: DecisionModelCall) => ({
    outcome: "answered",
    answer: Object.fromEntries(
      Object.entries(call.questions).map(([id, { written_for: title = "" }]) => [
        id,
        yes.get(title) ?? 0,
      ]),
    ),
    spent: [{ tokensIn: 120, tokensOut: 1, seconds: 0, outcome: "succeeded" }],
  });

const doorsWith = (decide: EntryScoringDoors["decide"]): EntryScoringDoors => ({
  found: async () => ["iri:first", "iri:second", "iri:third"],
  planned: async () => ENTRIES,
  decide,
});

describe("the entry step's scoring", () => {
  it("asks of each entry point apart, numbered in order", () => {
    expect(scoringCall("Which one?", ENTRIES)).toEqual({
      state: "Which one?",
      questions: {
        "1": {
          ask: "Does this approved answer answer the question in the state?",
          written_for: "First?",
          answer: "The first.",
        },
        "2": {
          ask: "Does this approved answer answer the question in the state?",
          written_for: "Second?",
          answer: "",
        },
        "3": {
          ask: "Does this approved answer answer the question in the state?",
          written_for: "Third?",
          answer: "The third.",
        },
      },
    });
  });

  it("reorders by probability of yes, keeping ties in order", () => {
    expect(reranked(ENTRIES, { "1": 0.2, "2": 0.9, "3": 0.2 })).toEqual([
      "iri:second",
      "iri:first",
      "iri:third",
    ]);
  });

  it("counts recall by find, the entry step and the decision", async () => {
    const scoring = await readEntryScoring(
      [{ question: "Which is third?", answers: ["third"] }],
      LANDED,
      doorsWith(decidingBy(new Map([["Third?", 0.8]]))),
      1,
    );

    expect([
      scoring.byFind.byAnswer,
      scoring.byEntryStep.byAnswer,
      scoring.byDecision.byAnswer,
    ]).toEqual([
      { asked: 1, recalled: 0, recall: 0 },
      { asked: 1, recalled: 0, recall: 0 },
      { asked: 1, recalled: 1, recall: 1 },
    ]);
    expect([scoring.unscored, scoring.tokensIn]).toEqual([0, 120]);
  });

  it("keeps the entry step's order where a call fails", async () => {
    const scoring = await readEntryScoring(
      [{ question: "Which is first?", answers: ["first"] }],
      LANDED,
      doorsWith(async () => ({ outcome: "failed", spent: [] })),
      1,
    );

    expect([scoring.byDecision.byAnswer.recalled, scoring.unscored]).toEqual([1, 1]);
  });
});
