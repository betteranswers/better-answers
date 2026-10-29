import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ASK_CAPS } from "../../src/answering/index.ts";
import { visibilitySuite } from "../fixtures/sourced-concept.ts";
import { theReuseSet } from "../readings/reuse-set.ts";
import {
  answersOf,
  bothSetsOf,
  rankedOverTheRecallSet,
  readBuyerQuestions,
  readRecallSet,
  recallAt,
  RECALL_DEPTH,
  theBuyerQuestions,
  theRecallSet,
  type BuyerQuestions,
  type RecallAnswer,
  type RecallQuestion,
} from "./recall.ts";

const suite = visibilitySuite();
const { db } = suite;

const carryingACollection = (
  question: RecallQuestion,
): question is RecallQuestion & { readonly collection: string } =>
  question.collection !== undefined;

describe("recall over the synthetic set", () => {
  let rankings: Awaited<ReturnType<typeof rankedOverTheRecallSet>>;

  beforeAll(async () => {
    rankings = await rankedOverTheRecallSet(suite);
  }, 300_000);

  const bothSets = () => bothSetsOf(rankings.set);

  it("lands a set whose walk adds no concept", async () => {
    const { rows } = await db().pool.query<{ edges: number }>(
      "SELECT count(*)::int AS edges FROM map_edge WHERE workspace_id = $1",
      [rankings.workspaceId],
    );

    expect(rows).toEqual([{ edges: 0 }]);
  });

  it("keeps a narrowed reading inside the collection named", async () => {
    const { set, landed, planned } = rankings;
    const groupOf = new Map<string | undefined, string>(
      answersOf(set).map(({ key, group }) => [landed.get(key), group]),
    );
    const narrowed = (await bothSets())
      .flatMap(([, questions]) => questions)
      .filter(carryingACollection);
    const readings: { question: string; returned: number; outside: readonly string[] }[] = [];
    for (const { question, collection } of narrowed) {
      const ranking = await planned(question, collection);
      readings.push({
        question,
        returned: ranking.length,
        outside: ranking.filter((iri) => groupOf.get(iri) !== collection),
      });
    }

    expect(readings.filter(({ outside }) => outside.length > 0)).toEqual([]);
    expect(readings.reduce((sum, { returned }) => sum + returned, 0)).toBeGreaterThan(0);
  }, 300_000);

  it("ranks ask's plan step as find ranks", async () => {
    const { found, planned } = rankings;
    const depth = Math.min(RECALL_DEPTH, ASK_CAPS.entryPoints);
    const readings: { question: string; byFind: string; byAsk: string; found: number }[] = [];
    for (const [, questions] of await bothSets()) {
      for (const { question } of questions) {
        const byFind = (await found(question)).slice(0, depth);
        const byAsk = (await planned(question, undefined)).slice(0, depth);
        readings.push({
          question,
          byFind: byFind.join(),
          byAsk: byAsk.join(),
          found: byFind.length,
        });
      }
    }

    expect(readings.filter(({ byFind, byAsk }) => byFind !== byAsk)).toEqual([]);
    expect(readings.filter(({ found: count }) => count > 0).length).toBeGreaterThan(0);
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

const placed = async (path: string, text: string | undefined): Promise<string> => {
  if (text !== undefined) await writeFile(path, text);
  return path;
};

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
    const path = await placed(join(scratch, `${refused.replaceAll(" ", "-")}.json`), text);

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
  new URL("../../../../.planning/client-bundle/", import.meta.url),
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

    const borrowed = (await syntheticTexts())
      .filter(([text, named]) => borrowedFrom(bundle, text, named))
      .map(([text]) => text);

    expect(bundle.runs.size).toBeGreaterThan(0);
    expect(borrowed).toEqual([]);
  });
});

const wordingsOf = ({ title, body, paraphrases }: RecallAnswer): readonly string[] =>
  [title, ...body.split("\n"), ...paraphrases].map(phraseOf);

const wordsItsAnswer = (answer: RecallAnswer | undefined, question: string): boolean =>
  answer !== undefined && wordingsOf(answer).includes(phraseOf(question));

describe("the buyer-worded set", () => {
  it("words no question as its Answer's title or line", async () => {
    const set = await theRecallSet();
    const byKey = new Map(answersOf(set).map((answer) => [answer.key, answer]));
    const { questions } = await theBuyerQuestions(set);

    const repeating = questions.flatMap(({ question, answers }) =>
      answers
        .filter((key) => wordsItsAnswer(byKey.get(key), question))
        .map((key) => `${question} (${key})`),
    );

    expect(repeating).toEqual([]);
  });
});
