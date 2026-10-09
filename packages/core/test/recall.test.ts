import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { find } from "../src/answering/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { recordFigures } from "./figures.ts";
import {
  answersOf,
  landRecallSet,
  readRecallSet,
  recallAt,
  RECALL_DEPTH,
  theRecallSet,
} from "./recall.ts";
import { visibilitySuite } from "./sourced-concept.ts";
import { answered } from "./suite-postgres.ts";

const { arrange, reading } = visibilitySuite();

const NOW = new Date("2026-10-09T12:00:00.000Z");

/** `find`'s concept matches for `question`, best first, as `person` reads them. */
const conceptsFound =
  (person: UserPrincipal) =>
  async (question: string): Promise<readonly string[]> => {
    const found = answered(
      await reading(person, (reader, tx) =>
        find(reader, tx, { query: question, limit: RECALL_DEPTH }, NOW),
      ),
    );
    return found.matches.flatMap((match) => (match.layer === "bundles" ? [match.iri] : []));
  };

describe("recall at ten over the synthetic set", () => {
  it("reports find's recall beside the corpus size", async () => {
    const set = await theRecallSet();
    const scenario = await arrange();
    const landed = await landRecallSet(scenario, set);

    const recall = await recallAt(set, landed, conceptsFound(scenario.viewer));

    await recordFigures("Recall at ten over the synthetic set", [
      [
        "the master Answer in find's first ten concepts",
        `${(recall.recall * 100).toFixed(1)} %, for ${recall.recalled} of ${recall.asked} paraphrases`,
      ],
      ["the corpus", `${landed.size} synthetic Answers`],
      ["the route's threshold, reported and never enforced", "90 %"],
    ]);
    const answers = answersOf(set);
    expect(landed.size).toBe(answers.length);
    expect(recall.asked).toBe(answers.flatMap(({ paraphrases }) => paraphrases).length);
    expect(recall.recall).toBeGreaterThanOrEqual(0);
    expect(recall.recall).toBeLessThanOrEqual(1);
  }, 300_000);
});

describe("the recall set's reader", () => {
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "recall-set-"));
  });

  afterAll(() => rm(scratch, { recursive: true }));

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

const CUSTOMER_BUNDLE = fileURLToPath(
  new URL("../../../.planning/client-bundle/", import.meta.url),
);

/** Eight words in a row shared with the bundle count as wording taken from it. */
const RUN_OF_WORDS = 8;

const wordsOf = (text: string): readonly string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}]+(?:'\p{L}+)?/gu) ?? [];

const phraseOf = (text: string): string => wordsOf(text).join(" ");

const runsOf = (text: string): readonly string[] => {
  const words = wordsOf(text);
  return Array.from({ length: Math.max(0, words.length - RUN_OF_WORDS + 1) }, (_unused, at) =>
    words.slice(at, at + RUN_OF_WORDS).join(" "),
  );
};

type Wording = { readonly names: ReadonlySet<string>; readonly runs: ReadonlySet<string> };

/** Every title and heading in the bundle's Markdown as a phrase, and every run of its words. */
const bundleWording = async (root: string): Promise<Wording> => {
  const names = new Set<string>();
  const runs = new Set<string>();
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith(".md"));
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8");
    for (const [, name] of text.matchAll(/^(?:#{1,6}\s+|title:\s*)(.+)$/gm)) {
      names.add(phraseOf(name ?? ""));
    }
    for (const run of runsOf(text)) runs.add(run);
  }
  return { names, runs };
};

const borrowedFrom = (bundle: Wording, text: string, named: boolean): boolean =>
  (named && bundle.names.has(phraseOf(text))) || runsOf(text).some((run) => bundle.runs.has(run));

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
