import type { ProsePart } from "@/shared/api/ask-stream.ts";

import type { ShownAnswer } from "./answer-view.tsx";
import type { YourRecord } from "./ask-api.ts";

type Concept = YourRecord["concepts"][number];

const isAnAnswer = (concept: Concept): boolean => concept.judged === "yes";

const proseOf = (record: YourRecord): readonly ProsePart[] => {
  const collectionOf = new Map(record.concepts.map((concept) => [concept.iri, concept.collection]));
  const parts = Map.groupBy(record.drafted ?? [], (sentence) => {
    const first = sentence.concepts.find((iri) => collectionOf.has(iri));
    return first === undefined ? null : (collectionOf.get(first) ?? null);
  });
  return [...parts].map(([collection, sentences]) => ({
    collection,
    sentences,
    outcome: undefined,
  }));
};

export const shownAnswerOf = (record: YourRecord): ShownAnswer | undefined => {
  const { verdict, judgeState, concepts } = record;
  if (verdict === null || judgeState === null) return undefined;
  return {
    verdict,
    judgeState,
    answers: concepts.filter(isAnAnswer),
    related: concepts.filter((concept) => !isAnAnswer(concept)),
    unmappedPassages: [],
    prose: proseOf(record),
  };
};
