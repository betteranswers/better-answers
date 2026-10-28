import { beforeAll, describe, expect, it } from "vitest";

import { ASK_CAPS } from "../../src/answering/index.ts";
import {
  answersOf,
  bothSetsOf,
  rankedOverTheRecallSet,
  recallAt,
  RECALL_DEPTH,
  worded,
  type RecallQuestion,
  type Recalls,
} from "../answering/recall.ts";
import { visibilitySuite } from "../fixtures/sourced-concept.ts";
import { recordFigures, type Figure } from "../support/figures.ts";

const suite = visibilitySuite();

const figuresOf = (
  read: string,
  { byAnswer, everyAnswer, anyAnswer }: Recalls,
): readonly Figure[] => [
  [`${read}, by Answer named`, worded(byAnswer, "Answers named")],
  [`${read}, questions reaching every Answer named`, worded(everyAnswer, "questions")],
  [`${read}, questions reaching at least one`, worded(anyAnswer, "questions")],
];

describe("recall over the synthetic set", () => {
  let rankings: Awaited<ReturnType<typeof rankedOverTheRecallSet>>;

  beforeAll(async () => {
    rankings = await rankedOverTheRecallSet(suite);
  }, 300_000);

  it("reports each set's recall and fails no build", async () => {
    const { set, landed, found, planned } = rankings;
    const entryCap = ASK_CAPS.entryPoints;
    const byFind = ({ question }: RecallQuestion) => found(question);
    const unnamed = ({ question }: RecallQuestion) => planned(question, undefined);
    const named = ({ question, collection }: RecallQuestion) => planned(question, collection);
    const byAsk = `ask's first ${entryCap} entry points`;

    const figures: Figure[] = [];
    for (const [name, questions] of await bothSetsOf(set)) {
      const carrying = questions.filter(({ collection }) => collection !== undefined);
      const readings = [
        [`${name} in find's first ${RECALL_DEPTH} concepts`, questions, byFind, RECALL_DEPTH],
        [`${name} in ${byAsk}`, questions, unnamed, entryCap],
        [`${name} carrying a collection in ${byAsk}, none named`, carrying, unnamed, entryCap],
        [`${name} carrying a collection in ${byAsk}, theirs named`, carrying, named, entryCap],
      ] as const;
      for (const [label, asked, ranked, depth] of readings) {
        const recalls = await recallAt(asked, landed, ranked, depth);
        figures.push(...figuresOf(label, recalls));

        const { byAnswer, everyAnswer, anyAnswer } = recalls;
        expect([byAnswer.asked, everyAnswer.asked, anyAnswer.asked]).toEqual([
          asked.flatMap(({ answers }) => answers).length,
          asked.length,
          asked.length,
        ]);
      }
    }

    const wider = set.groups.filter(({ answers }) => answers.length > entryCap).length;
    await recordFigures("Recall over the synthetic set", [
      ...figures,
      [
        "collections holding more Answers than the entry cap, which alone it can cut",
        `${wider} of ${set.groups.length}`,
      ],
      ["the corpus", `${landed.size} synthetic Answers`],
      ["the route's threshold, reported and never enforced", "90 %"],
    ]);
    expect(landed.size).toBe(answersOf(set).length);
  }, 300_000);
});
