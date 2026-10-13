import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ASK_CAPS, askInput, find, planAnswer } from "../src/answering/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { recordFigures, type Figure } from "./figures.ts";
import {
  answersOf,
  landRecallSet,
  paraphrasesOf,
  readBuyerQuestions,
  readRecallSet,
  recallAt,
  RECALL_DEPTH,
  theBuyerQuestions,
  theRecallSet,
  type Recall,
  type RecallAnswer,
  type RecallQuestion,
  type Recalls,
} from "./recall.ts";
import { visibilitySuite } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { answered } from "./suite-postgres.ts";

const { arrange, reading } = visibilitySuite();

const NOW = new Date("2026-10-09T12:00:00.000Z");

/** `find`'s concept matches for a question, best first, as `person` reads them. */
const conceptsFound =
  (person: UserPrincipal) =>
  async ({ question }: RecallQuestion): Promise<readonly string[]> => {
    const found = answered(
      await reading(person, (reader, tx) =>
        find(reader, tx, { query: question, limit: RECALL_DEPTH }, NOW),
      ),
    );
    return found.matches.flatMap((match) => (match.layer === "bundles" ? [match.iri] : []));
  };

type Narrowing = "no collection named" | "its collection named";

/** Entry points alone: no `Answer` of the set links to another, so the walk adds no concept. */
const conceptsPlanned =
  (person: UserPrincipal, narrowing: Narrowing) =>
  async ({ question, collection }: RecallQuestion): Promise<readonly string[]> => {
    const named = narrowing === "its collection named" && collection !== undefined;
    const asking = { question, collections: named ? [collection] : [] };
    const planned = answered(
      await reading(person, (reader, tx) =>
        planAnswer(reader, (work) => work(tx), inputOf(askInput, asking), NOW, ASK_CAPS),
      ),
    );
    return planned.related.map(({ iri }) => iri);
  };

const worded = ({ recall, recalled, asked }: Recall, counted: string): string =>
  `${(recall * 100).toFixed(1)} %, for ${recalled} of ${asked} ${counted}`;

/** By `Answer` named leads: it is the figure a cap is sized from. */
const figuresOf = (
  read: string,
  { byAnswer, everyAnswer, anyAnswer }: Recalls,
): readonly Figure[] => [
  [`${read}, by Answer named`, worded(byAnswer, "Answers named")],
  [`${read}, questions reaching every Answer named`, worded(everyAnswer, "questions")],
  [`${read}, questions reaching at least one`, worded(anyAnswer, "questions")],
];

describe("recall over the synthetic set", () => {
  it("reports each set's recall and fails no build", async () => {
    const set = await theRecallSet();
    const scenario = await arrange();
    const landed = await landRecallSet(scenario, set);
    const entryCap = ASK_CAPS.entryPoints;
    const reads = [
      ["find's first ten concepts", conceptsFound(scenario.viewer), RECALL_DEPTH],
      [
        `ask's first ${entryCap} entry points`,
        conceptsPlanned(scenario.viewer, "no collection named"),
        entryCap,
      ],
      [
        `ask's first ${entryCap} entry points with its collection named`,
        conceptsPlanned(scenario.viewer, "its collection named"),
        entryCap,
      ],
    ] as const;
    const sets = [
      ["paraphrases", paraphrasesOf(set)],
      ["buyer-worded questions", (await theBuyerQuestions(set)).questions],
    ] as const;

    const figures: Figure[] = [];
    for (const [name, questions] of sets) {
      const named = questions.flatMap(({ answers }) => answers).length;
      for (const [read, ranked, depth] of reads) {
        const recalls = await recallAt(questions, landed, ranked, depth);
        figures.push(...figuresOf(`${name} in ${read}`, recalls));

        const { byAnswer, everyAnswer, anyAnswer } = recalls;
        expect([byAnswer.asked, everyAnswer.asked, anyAnswer.asked]).toEqual([
          named,
          questions.length,
          questions.length,
        ]);
        expect(everyAnswer.recalled).toBeLessThanOrEqual(anyAnswer.recalled);
        expect(anyAnswer.recalled).toBeLessThanOrEqual(byAnswer.recalled);
        expect(byAnswer.recalled).toBeLessThanOrEqual(named);
      }
    }

    await recordFigures("Recall over the synthetic set", [
      ...figures,
      ["the corpus", `${landed.size} synthetic Answers`],
      ["the route's threshold, reported and never enforced", "90 %"],
    ]);
    expect(landed.size).toBe(answersOf(set).length);
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

describe("the buyer-worded set's reader", () => {
  it("refuses a question that names no Answer", async () => {
    const held = await theBuyerQuestions(await theRecallSet());
    const [first, ...rest] = held.questions;
    const path = join(scratch, "a-question-naming-no-answer.json");
    await writeFile(
      path,
      JSON.stringify({ ...held, questions: [{ ...first, answers: [] }, ...rest] }),
    );

    expect((await readBuyerQuestions(path)).ok).toBe(false);
  });
});

const CUSTOMER_BUNDLE = fileURLToPath(
  new URL("../../../.planning/client-bundle/", import.meta.url),
);

/** Eight words in a row shared with the bundle count as wording taken from it. */
const RUN_OF_WORDS = 8;

/** A title or paraphrase this long, found anywhere in the bundle's text, counts as taken from it. */
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

/** The bundle's Markdown: its titles and headings as phrases, its runs of words, each file's words. */
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

describe("the recall set's provenance", () => {
  it("takes no title, paraphrase or wording from the customer's bundle", async (context) => {
    context.skip(
      !existsSync(CUSTOMER_BUNDLE),
      "the customer's bundle is machine-local, so only the owner's machine can compare against it",
    );
    const bundle = await bundleWording(CUSTOMER_BUNDLE);

    const borrowed = answersOf(await theRecallSet()).flatMap(({ title, body, paraphrases }) =>
      [
        ...[title, ...paraphrases].map((text) => [text, true] as const),
        [body, false] as const,
      ].flatMap(([text, named]) => (borrowedFrom(bundle, text, named) ? [text] : [])),
    );

    expect(bundle.runs.size).toBeGreaterThan(0);
    expect(borrowed).toEqual([]);
  });
});

/** Every wording the set holds an `Answer` under: its title, each line of its body, each paraphrase. */
const wordingsOf = ({ title, body, paraphrases }: RecallAnswer): readonly string[] =>
  [title, ...body.split("\n"), ...paraphrases].map(phraseOf);

describe("the buyer-worded set", () => {
  it("words no question as its Answer's title or line", async () => {
    const set = await theRecallSet();
    const byKey = new Map(answersOf(set).map((answer) => [answer.key, answer]));
    const { questions } = await theBuyerQuestions(set);

    const worded = questions.flatMap(({ question, answers }) =>
      answers.flatMap((key) => {
        const answer = byKey.get(key);
        return answer !== undefined && wordingsOf(answer).includes(phraseOf(question))
          ? [`${question} (${key})`]
          : [];
      }),
    );

    expect(worded).toEqual([]);
  });
});
