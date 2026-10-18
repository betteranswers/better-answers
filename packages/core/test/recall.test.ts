import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ASK_CAPS, askInput, planAnswer } from "../src/answering/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { recordFigures, type Figure } from "./figures.ts";
import { theReuseSet } from "./readings/reuse-set.ts";
import {
  answersOf,
  conceptsFoundBy,
  landRecallSet,
  paraphrasesOf,
  readBuyerQuestions,
  readRecallSet,
  recallAt,
  RECALL_DEPTH,
  theBuyerQuestions,
  theRecallSet,
  worded,
  type BuyerQuestions,
  type RecallAnswer,
  type RecallQuestion,
  type Recalls,
  type RecallSet,
} from "./recall.ts";
import { visibilitySuite } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { answered } from "./suite-postgres.ts";

const { arrange, reading, db } = visibilitySuite();

const NOW = new Date("2026-10-09T12:00:00.000Z");

type Ranking = Promise<readonly string[]>;

const kept = <Asking extends readonly unknown[]>(rank: (...asking: Asking) => Ranking) => {
  const held = new Map<string, Ranking>();
  return (...asking: Asking): Ranking => {
    const key = JSON.stringify(asking);
    const ranking = held.get(key) ?? rank(...asking);
    held.set(key, ranking);
    return ranking;
  };
};

const conceptsFound = (person: UserPrincipal) => kept(conceptsFoundBy(reading, person, NOW));

const conceptsPlanned = (person: UserPrincipal) =>
  kept(async (question: string, collection: string | undefined) => {
    const asking = { question, collections: collection === undefined ? [] : [collection] };
    const planned = answered(
      await reading(person, (reader, tx) =>
        planAnswer(reader, (work) => work(tx), inputOf(askInput, asking), NOW, ASK_CAPS),
      ),
    );
    return planned.related.map(({ iri }) => iri);
  });

const figuresOf = (
  read: string,
  { byAnswer, everyAnswer, anyAnswer }: Recalls,
): readonly Figure[] => [
  [`${read}, by Answer named`, worded(byAnswer, "Answers named")],
  [`${read}, questions reaching every Answer named`, worded(everyAnswer, "questions")],
  [`${read}, questions reaching at least one`, worded(anyAnswer, "questions")],
];

describe("recall over the synthetic set", () => {
  let set: RecallSet;
  let landed: ReadonlyMap<string, string>;
  let workspaceId: string;
  let found: ReturnType<typeof conceptsFound>;
  let planned: ReturnType<typeof conceptsPlanned>;

  beforeAll(async () => {
    set = await theRecallSet();
    const scenario = await arrange();
    landed = await landRecallSet(scenario, set);
    workspaceId = scenario.workspaceId;
    found = conceptsFound(scenario.viewer);
    planned = conceptsPlanned(scenario.viewer);
  }, 300_000);

  const bothSets = async () =>
    [
      ["paraphrases", paraphrasesOf(set)],
      ["buyer-worded questions", (await theBuyerQuestions(set)).questions],
    ] as const;

  it("reports each set's recall and fails no build", async () => {
    const entryCap = ASK_CAPS.entryPoints;
    const byFind = ({ question }: RecallQuestion) => found(question);
    const unnamed = ({ question }: RecallQuestion) => planned(question, undefined);
    const named = ({ question, collection }: RecallQuestion) => planned(question, collection);
    const byAsk = `ask's first ${entryCap} entry points`;

    const figures: Figure[] = [];
    for (const [name, questions] of await bothSets()) {
      const carrying = questions.filter(({ collection }) => collection !== undefined);
      const readings = [
        [`${name} in find's first ${RECALL_DEPTH} concepts`, questions, byFind, RECALL_DEPTH],
        [`${name} in ${byAsk}`, questions, unnamed, entryCap],
        [`${name} carrying a collection in ${byAsk}, none named`, carrying, unnamed, entryCap],
        [`${name} carrying a collection in ${byAsk}, theirs named`, carrying, named, entryCap],
      ] as const;
      for (const [reading, asked, ranked, depth] of readings) {
        const recalls = await recallAt(asked, landed, ranked, depth);
        figures.push(...figuresOf(reading, recalls));

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

  it("lands a set whose walk adds no concept", async () => {
    const { rows } = await db().pool.query<{ edges: number }>(
      "SELECT count(*)::int AS edges FROM map_edge WHERE workspace_id = $1",
      [workspaceId],
    );

    expect(rows).toEqual([{ edges: 0 }]);
  });

  it("keeps a narrowed reading inside the collection named", async () => {
    const groupOf = new Map(answersOf(set).map(({ key, group }) => [landed.get(key), group]));
    const outside: string[] = [];
    let returned = 0;
    for (const [, questions] of await bothSets()) {
      for (const { question, collection } of questions) {
        if (collection === undefined) continue;
        const ranking = await planned(question, collection);
        returned += ranking.length;
        if (ranking.some((iri) => groupOf.get(iri) !== collection)) outside.push(question);
      }
    }

    expect(outside).toEqual([]);
    expect(returned).toBeGreaterThan(0);
  }, 300_000);

  it("ranks ask's plan step as find ranks", async () => {
    const depth = Math.min(RECALL_DEPTH, ASK_CAPS.entryPoints);
    const apart: string[] = [];
    let matching = 0;
    for (const [, questions] of await bothSets()) {
      for (const { question } of questions) {
        const byFind = (await found(question)).slice(0, depth);
        const byAsk = (await planned(question, undefined)).slice(0, depth);
        if (byFind.join() !== byAsk.join()) apart.push(question);
        if (byFind.length > 0) matching += 1;
      }
    }

    expect(apart).toEqual([]);
    expect(matching).toBeGreaterThan(0);
  }, 300_000);
});

describe("recall", () => {
  it("counts every Answer, any Answer and each Answer named", async () => {
    const landed = new Map([
      ["first", "iri:first"],
      ["second", "iri:second"],
      ["third", "iri:third"],
    ]);
    const ranked = () => Promise.resolve(["iri:first", "iri:second", "iri:third"]);

    const recalls = await recallAt(
      [
        { question: "both inside the depth", answers: ["first", "second"] },
        { question: "one beyond the depth", answers: ["first", "third"] },
        { question: "its one beyond the depth", answers: ["third"] },
        { question: "its one inside the depth", answers: ["second"] },
      ],
      landed,
      ranked,
      2,
    );

    expect(recalls).toEqual({
      everyAnswer: { asked: 4, recalled: 2, recall: 0.5 },
      anyAnswer: { asked: 4, recalled: 3, recall: 0.75 },
      byAnswer: { asked: 6, recalled: 4, recall: 4 / 6 },
    });
  });
});

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "recall-set-"));
});

afterAll(() => rm(scratch, { recursive: true }));

describe("the recall set's reader", () => {
  it.each([
    ["a file that is not there", undefined],
    ["text that is not JSON", "{ groups: "],
    ["a set with no groups", JSON.stringify({ note: "", groups: [] })],
    [
      "a group with no answers",
      JSON.stringify({ note: "", groups: [{ group: "empty", answers: [] }] }),
    ],
  ])("refuses %s", async (refused, text) => {
    const path = join(scratch, `${refused.replaceAll(" ", "-")}.json`);
    if (text !== undefined) await writeFile(path, text);

    expect((await readRecallSet(path)).ok).toBe(false);
  });
});

const altered = (
  held: BuyerQuestions,
  change: { readonly question?: object; readonly source?: object },
): unknown => {
  const [first, ...rest] = held.questions;
  const [form] = held.sources;
  return {
    ...held,
    sources:
      change.source === undefined ? held.sources : [...held.sources, { ...form, ...change.source }],
    questions: [{ ...first, ...change.question }, ...rest],
  };
};

describe("the buyer-worded set's reader", () => {
  it.each([
    ["a question that names no Answer", { question: { answers: [] } }],
    [
      "a question naming one Answer twice",
      { question: { answers: ["what-tallyloom-is", "what-tallyloom-is"] } },
    ],
    ["a question citing a source the set lacks", { question: { source: "no-such-form" } }],
    ["a source no question cites", { source: { id: "an-uncited-form" } }],
  ])("refuses %s", async (refused, change) => {
    const held = await theBuyerQuestions(await theRecallSet());
    const path = join(scratch, `${refused.replaceAll(" ", "-")}.json`);
    await writeFile(path, JSON.stringify(altered(held, change)));

    expect((await readBuyerQuestions(path)).ok).toBe(false);
  });

  it("reads the set with nothing changed", async () => {
    const held = await theBuyerQuestions(await theRecallSet());
    const path = join(scratch, "the-set-unchanged.json");
    await writeFile(path, JSON.stringify(altered(held, {})));

    expect((await readBuyerQuestions(path)).ok).toBe(true);
  });
});

const CUSTOMER_BUNDLE = fileURLToPath(
  new URL("../../../.planning/client-bundle/", import.meta.url),
);

const RUN_OF_WORDS = 8;

const NAMED_WORDS = 5;

const wordsOf = (text: string): readonly string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}]+(?:'\p{L}+)?/gu) ?? [];

const phraseOf = (text: string): string => wordsOf(text).join(" ");

const runsOf = (text: string): readonly string[] => {
  const words = wordsOf(text);
  return Array.from({ length: Math.max(0, words.length - RUN_OF_WORDS + 1) }, (_unused, at) =>
    words.slice(at, at + RUN_OF_WORDS).join(" "),
  );
};

type Wording = {
  readonly names: ReadonlySet<string>;
  readonly runs: ReadonlySet<string>;
  readonly texts: readonly string[];
};

const bundleWording = async (root: string): Promise<Wording> => {
  const names = new Set<string>();
  const runs = new Set<string>();
  const texts: string[] = [];
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith(".md"));
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8");
    for (const [, name] of text.matchAll(/^(?:#{1,6}\s+|title:\s*)(.+)$/gm)) {
      names.add(phraseOf(name ?? ""));
    }
    for (const run of runsOf(text)) runs.add(run);
    texts.push(` ${phraseOf(text)} `);
  }
  return { names, runs, texts };
};

const namedIn = (bundle: Wording, text: string): boolean => {
  const phrase = phraseOf(text);
  return (
    bundle.names.has(phrase) ||
    (wordsOf(text).length >= NAMED_WORDS &&
      bundle.texts.some((held) => held.includes(` ${phrase} `)))
  );
};

const borrowedFrom = (bundle: Wording, text: string, named: boolean): boolean =>
  (named && namedIn(bundle, text)) || runsOf(text).some((run) => bundle.runs.has(run));

const syntheticTexts = async (): Promise<readonly (readonly [string, boolean])[]> => {
  const reuse = await theReuseSet();
  return [
    ...answersOf(await theRecallSet()).flatMap(({ title, body, paraphrases }) => [
      ...[title, ...paraphrases].map((text) => [text, true] as const),
      [body, false] as const,
    ]),
    ...reuse.groups.flatMap(({ answers }) =>
      answers.flatMap(({ title, body }) => [[title, true] as const, [body, false] as const]),
    ),
    ...reuse.questions.map(({ question }) => [question, true] as const),
  ];
};

describe("the synthetic sets' provenance", () => {
  it("takes no title, question or wording from the customer's bundle", async (context) => {
    context.skip(
      !existsSync(CUSTOMER_BUNDLE),
      "the customer's bundle is machine-local, so only the owner's machine can compare against it",
    );
    const bundle = await bundleWording(CUSTOMER_BUNDLE);

    const borrowed = (await syntheticTexts()).flatMap(([text, named]) =>
      borrowedFrom(bundle, text, named) ? [text] : [],
    );

    expect(bundle.runs.size).toBeGreaterThan(0);
    expect(borrowed).toEqual([]);
  });
});

const wordingsOf = ({ title, body, paraphrases }: RecallAnswer): readonly string[] =>
  [title, ...body.split("\n"), ...paraphrases].map(phraseOf);

describe("the buyer-worded set", () => {
  it("words no question as its Answer's title or line", async () => {
    const set = await theRecallSet();
    const byKey = new Map(answersOf(set).map((answer) => [answer.key, answer]));
    const { questions } = await theBuyerQuestions(set);

    const repeating = questions.flatMap(({ question, answers }) =>
      answers.flatMap((key) => {
        const answer = byKey.get(key);
        return answer !== undefined && wordingsOf(answer).includes(phraseOf(question))
          ? [`${question} (${key})`]
          : [];
      }),
    );

    expect(repeating).toEqual([]);
  });
});
