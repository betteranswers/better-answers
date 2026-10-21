// @vitest-environment node

import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid, type ConceptIri } from "@better-answers/schema";

import type { YourRecord } from "@/features/ask/ask-api.ts";
import { shownAnswerOf } from "@/features/ask/shown-answer.ts";

type Concept = YourRecord["concepts"][number];

const aConcept = (collection: string | null, judged?: "yes" | "no"): Concept => {
  const concept = {
    iri: conceptIriOf(ulid()),
    kind: "Policy",
    title: "Retention",
    collection,
    trustWords: "Unverified",
  };
  return judged === undefined ? concept : { ...concept, judged };
};

const aRecord = (record: Partial<YourRecord>): YourRecord => ({
  id: ulid(),
  askedAt: "2026-10-01T09:00:00.000Z",
  askedBy: { kind: "former-member" },
  transport: "trpc",
  collectionsNamed: [],
  question: "How long are audit logs kept?",
  verdict: "related",
  judgeState: "judged",
  map: { state: "unknown" },
  flagged: false,
  concepts: [],
  drafted: null,
  feedback: [],
  ...record,
});

const citing = (sentence: string, concepts: readonly Concept[]) => ({
  sentence,
  concepts: concepts.map(({ iri }): ConceptIri => iri),
});

describe("a kept record shown as an answer", () => {
  it("shows the judge's passed concepts as answers, the rest related", () => {
    const passed = aConcept("audits", "yes");
    const failed = aConcept("audits", "no");
    const unjudged = aConcept(null);

    const shown = shownAnswerOf(aRecord({ verdict: "ok", concepts: [failed, passed, unjudged] }));

    expect(shown?.answers).toEqual([passed]);
    expect(shown?.related).toEqual([failed, unjudged]);
  });

  it("groups kept sentences under their first cited concept's collection", () => {
    const [audits, board, loose] = [aConcept("audits"), aConcept("board"), aConcept(null)];
    const kept = citing("Logs are kept a year.", [audits]);
    const boards = citing("The board meets monthly.", [board, audits]);
    const both = citing("Both are filed.", [audits, board]);
    const nowhere = citing("Nothing else is.", [loose]);

    const shown = shownAnswerOf(
      aRecord({ concepts: [audits, board, loose], drafted: [kept, boards, both, nowhere] }),
    );

    expect(shown?.prose).toEqual([
      { collection: "audits", sentences: [kept, both], outcome: undefined },
      { collection: "board", sentences: [boards], outcome: undefined },
      { collection: null, sentences: [nowhere], outcome: undefined },
    ]);
  });

  it("gives an unfinished record no result", () => {
    expect(shownAnswerOf(aRecord({ verdict: null, judgeState: null }))).toBeUndefined();
  });
});
