import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { ASK_CAPS, askInput, planAnswer } from "../../src/answering/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { openModelClient, type ModelClient, type ModelToCall } from "../../src/llm/index.ts";
import { inMs, recordFigures, type Figure } from "../figures.ts";
import {
  conceptsFoundBy,
  landRecallSet,
  paraphrasesOf,
  RECALL_DEPTH,
  theBuyerQuestions,
  theRecallSet,
  worded,
  type RecallSet,
} from "../recall.ts";
import { visibilitySuite } from "../sourced-concept.ts";
import { inputOf } from "../suite-input.ts";
import { answered } from "../suite-postgres.ts";
import { readEntryScoring, type EntryPoint, type EntryScoring } from "./entry-scoring.ts";
import {
  poundsOf,
  readReuse,
  recordReuseReading,
  theReuseSet,
  type ReuseSet,
} from "./reuse-set.ts";

/** List prices in US dollars per million tokens in; Clef charges nothing out. Check the price page before a run. */
const MODELS = [
  { name: "Clef-flash", model: "clef-flash", usdIn: 0.038 },
  { name: "Clef", model: "clef", usdIn: 0.24 },
] as const;

/** No threshold is calibrated, so the reuse reading runs at each of these. */
const THRESHOLDS = [0.3, 0.5, 0.7, 0.9] as const;

const KEY_NEEDED =
  "set READING_WORKERS_AI_KEY to the account id, a colon, then the API token the reading spends";
const RATE_NEEDED = "set READING_GBP_PER_USD to the day's pounds per US dollar, such as 0.75";

const owner = z.object({
  READING_WORKERS_AI_KEY: z.string({ error: KEY_NEEDED }).regex(/^[0-9a-f]{32}:.+$/, KEY_NEEDED),
  READING_GBP_PER_USD: z
    .string({ error: RATE_NEEDED })
    .regex(/^\d+(\.\d+)?$/, RATE_NEEDED)
    .transform(Number),
});

type Told = z.infer<typeof owner>;

const clientFor = (): ModelClient =>
  openModelClient({
    fetch,
    clock: { now: () => new Date() },
    log: { info: () => {} },
  });

const toldByTheOwner = (): Told => {
  const read = owner.safeParse(process.env);
  if (!read.success) throw new Error(z.prettifyError(read.error));
  return read.data;
};

const { db, arrange, reading } = visibilitySuite();

describe("the owner's decision reading on reuse", () => {
  let set: ReuseSet;
  let told: Told;

  beforeAll(async () => {
    told = toldByTheOwner();
    set = await theReuseSet();
  });

  for (const { name, model, usdIn } of MODELS) {
    for (const threshold of THRESHOLDS) {
      it(`reads ${name} at threshold ${String(threshold)}`, async () => {
        const rate = told.READING_GBP_PER_USD;
        const judged = await readReuse(db(), set, {
          provider: "cloudflare",
          model,
          gbpPerMillionIn: poundsOf(usdIn, rate),
          gbpPerMillionOut: "0",
          key: told.READING_WORKERS_AI_KEY,
          decide: clientFor().decide,
          threshold,
        });
        const priced = `$${usdIn} in per million tokens and nothing out, at £${rate} to the dollar`;
        const heading = `Reuse reading, ${name} at threshold ${String(threshold)}`;
        await recordReuseReading(heading, judged, priced);

        // A refused key fails every call, and a run that decided nothing has no figures to record.
        expect(judged.judged).toBeGreaterThan(0);
      });
    }
  }
});

const NOW = new Date("2026-10-09T12:00:00.000Z");

const entryFigures = (name: string, scoring: EntryScoring, priced: string): readonly Figure[] => [
  [`${name} in find's first ${RECALL_DEPTH}`, worded(scoring.byFind.byAnswer, "Answers named")],
  [
    `${name} in the entry step's first ${RECALL_DEPTH}`,
    worded(scoring.byEntryStep.byAnswer, "Answers named"),
  ],
  [
    `${name} in the first ${RECALL_DEPTH} of ${ASK_CAPS.entryPoints} entry points the decision model reordered`,
    worded(scoring.byDecision.byAnswer, "Answers named"),
  ],
  [`${name} the decision model could not score`, String(scoring.unscored)],
  [`${name} tokens in`, `${scoring.tokensIn}, ${priced}`],
  [
    `${name} scoring latency`,
    `median ${inMs(scoring.scoreMs.median)}, worst ${inMs(scoring.scoreMs.worst)}`,
  ],
];

/** The entry step's points for a question with no collection named, as `person` reads them. */
const entryPointsFor =
  (person: UserPrincipal) =>
  async (question: string): Promise<readonly EntryPoint[]> => {
    const planned = answered(
      await reading(person, (reader, tx) =>
        planAnswer(reader, (work) => work(tx), inputOf(askInput, { question }), NOW, ASK_CAPS),
      ),
    );
    return planned.related.slice(0, ASK_CAPS.entryPoints).map((concept) => ({
      iri: concept.iri,
      title: concept.title,
      ...("body" in concept ? { body: concept.body } : {}),
    }));
  };

describe("the owner's decision reading at the entry step", () => {
  let set: RecallSet;
  let landed: ReadonlyMap<string, string>;
  let viewer: UserPrincipal;
  let told: Told;

  beforeAll(async () => {
    told = toldByTheOwner();
    set = await theRecallSet();
    const scenario = await arrange();
    landed = await landRecallSet(scenario, set);
    viewer = scenario.viewer;
  }, 300_000);

  for (const { name, model, usdIn } of MODELS) {
    it(`reads ${name} reordering the entry step's points`, async () => {
      const to: ModelToCall = {
        purpose: "judging",
        modelChoiceId: "the-owner's-reading",
        provider: "cloudflare",
        model,
        key: { reveal: () => told.READING_WORKERS_AI_KEY },
      };
      const { decide } = clientFor();
      const doors = {
        found: conceptsFoundBy(reading, viewer, NOW),
        planned: entryPointsFor(viewer),
        decide: (call: Parameters<typeof decide>[1]) => decide(to, call),
      };
      const priced = `$${usdIn} per million at £${told.READING_GBP_PER_USD} to the dollar`;
      const figures: Figure[] = [];
      const sets = [
        ["paraphrases", paraphrasesOf(set)],
        ["buyer-worded questions", (await theBuyerQuestions(set)).questions],
      ] as const;
      let unscored = 0;
      for (const [named, questions] of sets) {
        const scoring = await readEntryScoring(questions, landed, doors, RECALL_DEPTH);
        figures.push(...entryFigures(named, scoring, priced));
        unscored += scoring.unscored;
      }
      await recordFigures(`Entry step reading, ${name}`, figures);

      // A refused key fails every call, and a run that scored nothing has no figures to record.
      expect(unscored).toBeLessThan(paraphrasesOf(set).length);
    }, 3_600_000);
  }
});
