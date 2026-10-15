import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { ConceptIri } from "@better-answers/schema";

import { writeConcept } from "../src/concepts/index.ts";
import { attempt, err, ok, type Result } from "../src/kernel/index.ts";
import { doorsOf, type Scenario } from "./workspace-with-bundle.ts";

const RECALL_SET = fileURLToPath(new URL("./fixtures/recall-set.json", import.meta.url));

const BUYER_QUESTIONS = fileURLToPath(new URL("./fixtures/buyer-questions.json", import.meta.url));

/** How far down a ranking the master `Answer` may sit and still count as recalled. */
export const RECALL_DEPTH = 10;

const answerKey = z.string().regex(/^[a-z0-9-]+$/);

const recallAnswer = z.strictObject({
  key: answerKey,
  title: z.string().min(1),
  body: z.string().min(1),
  paraphrases: z.array(z.string().min(1)).min(1).max(2),
});

const recallSet = z.strictObject({
  note: z.string(),
  groups: z
    .array(
      z.strictObject({
        group: z.string().regex(/^[a-z0-9-]+$/),
        answers: z.array(recallAnswer).min(1),
      }),
    )
    .min(1),
});

export type RecallAnswer = z.infer<typeof recallAnswer>;
export type RecallSet = z.infer<typeof recallSet>;

export const answersOf = (set: RecallSet): readonly (RecallAnswer & { group: string })[] =>
  set.groups.flatMap(({ group, answers }) => answers.map((answer) => ({ ...answer, group })));

/** The JSON at `path` as `shape`, refused when it cannot be read, is not JSON or is not `shape`. */
export const readAs = async <Held>(
  path: string,
  shape: z.ZodType<Held>,
): Promise<Result<Held, Error>> => {
  const text = await attempt(() => readFile(path, "utf8"));
  if (!text.ok) return text;
  const json = await attempt(async (): Promise<unknown> => JSON.parse(text.value));
  if (!json.ok) return json;
  const parsed = shape.safeParse(json.value);
  return parsed.success ? ok(parsed.data) : err(new Error(z.prettifyError(parsed.error)));
};

/** The set at `path`, refused when it cannot be read, is not JSON, or holds no answer. */
export const readRecallSet = (path: string): Promise<Result<RecallSet, Error>> =>
  readAs(path, recallSet);

/** The repository's set; throws when it does not read, as a suite's setup should. */
export const theRecallSet = async (): Promise<RecallSet> => {
  const read = await readRecallSet(RECALL_SET);
  if (!read.ok) throw new Error(`the recall set did not read: ${read.error.message}`);
  return read.value;
};

/** `find` takes no longer a query, and the measure asks every question of both entries. */
const QUESTION_CHARACTERS_AT_MOST = 500;

const buyerQuestions = z
  .strictObject({
    note: z.string(),
    sources: z
      .array(
        z.strictObject({
          id: answerKey,
          form: z.string().min(1),
          publisher: z.string().min(1),
          url: z.url(),
          licence: z.string().min(1),
          notice: z.string().min(1),
          retrieved: z.iso.date(),
        }),
      )
      .min(1),
    questions: z
      .array(
        z.strictObject({
          question: z.string().min(1).max(QUESTION_CHARACTERS_AT_MOST),
          /** The `id` of the form it was taken from. */
          source: answerKey,
          /** Where in the form it stands. */
          at: z.string().min(1),
          /** The one group every `Answer` it names sits in, where there is one. */
          collection: answerKey.optional(),
          /** The key of each `Answer` of the recall set it must reach. */
          answers: z
            .array(answerKey)
            .min(1)
            .refine(
              (keys) => new Set(keys).size === keys.length,
              "a question names an Answer once, or recall by Answer counts it twice",
            ),
        }),
      )
      .min(1),
  })
  .refine(
    ({ sources, questions }) =>
      questions.every(({ source }) => sources.some(({ id }) => id === source)),
    "a question cites a source the set does not list",
  )
  .refine(
    ({ sources, questions }) =>
      sources.every(({ id }) => questions.some(({ source }) => source === id)),
    "a listed source is cited by no question",
  );

export type BuyerQuestions = z.infer<typeof buyerQuestions>;

/** Refused as the recall set is, and where its sources and its questions' citations do not pair. */
export const readBuyerQuestions = (path: string): Promise<Result<BuyerQuestions, Error>> =>
  readAs(path, buyerQuestions);

/** The group every key sits in, where they share one. A key `set` does not hold has none. */
const oneGroupOf = (
  groups: ReadonlyMap<string, string>,
  keys: readonly string[],
): string | undefined => {
  const [group, ...others] = new Set(keys.map((key) => groups.get(key)));
  return others.length === 0 ? group : undefined;
};

/**
 * Throws on a key `set` does not hold, counted otherwise as a miss, and on a collection that is
 * not its row's one group.
 */
export const theBuyerQuestions = async (set: RecallSet): Promise<BuyerQuestions> => {
  const read = await readBuyerQuestions(BUYER_QUESTIONS);
  if (!read.ok) throw new Error(`the buyer-worded set did not read: ${read.error.message}`);
  const groups = new Map(answersOf(set).map(({ key, group }) => [key, group]));
  const { questions } = read.value;
  const unheld = questions.flatMap(({ answers }) => answers.filter((key) => !groups.has(key)));
  if (unheld.length > 0) {
    throw new Error(`the buyer-worded set names no Answer of the recall set: ${unheld.join(", ")}`);
  }
  const misplaced = questions.filter(
    ({ collection, answers }) => collection !== oneGroupOf(groups, answers),
  );
  if (misplaced.length > 0) {
    throw new Error(
      `the buyer-worded set's collection is not its Answers' one group: ${misplaced.map(({ at }) => at).join(", ")}`,
    );
  }
  return read.value;
};

/** Writes every answer as a stable Internal `Answer` through `writeConcept`; each key's IRI. */
export const landRecallSet = async (
  scenario: Scenario,
  set: RecallSet,
): Promise<ReadonlyMap<string, ConceptIri>> => {
  const landed = new Map<string, ConceptIri>();
  let head: string | null = null;
  for (const { key, group, title, body } of answersOf(set)) {
    const written = await writeConcept(scenario.editor, doorsOf(scenario), {
      mergeKey: `answer:${key}`,
      path: `knowledge/${group}/${key}.md`,
      kind: "Answer",
      title,
      frontmatter: { title, type: "Answer", tags: [group] },
      body: `${body}\n`,
      message: `Record the ${key} answer`,
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      expects: { head },
      status: "stable",
      sensitivity: "Internal",
    });
    if (!written.ok) throw new Error(`the ${key} answer did not land: ${String(written.error)}`);
    head = written.value.sha;
    landed.set(key, written.value.iri);
  }
  return landed;
};

export type Recall = {
  readonly asked: number;
  readonly recalled: number;
  readonly recall: number;
};

/** A question the measure asks, and the key of each `Answer` it must reach. */
export type RecallQuestion = {
  readonly question: string;
  /** The collection every `Answer` it names sits in, where there is one. */
  readonly collection?: string | undefined;
  readonly answers: readonly string[];
};

/** Each paraphrase as a question that must reach its master `Answer`, in that `Answer`'s group. */
export const paraphrasesOf = (set: RecallSet): readonly RecallQuestion[] =>
  answersOf(set).flatMap(({ key, group, paraphrases }) =>
    paraphrases.map((question) => ({ question, collection: group, answers: [key] })),
  );

/** One reading counted three ways. A cap is sized from `byAnswer`. */
export type Recalls = {
  /** The questions that reach every `Answer` they name. */
  readonly everyAnswer: Recall;
  /** The questions that reach at least one. */
  readonly anyAnswer: Recall;
  /** The `Answer`s named, each counted once for each question that names it. */
  readonly byAnswer: Recall;
};

const recallOf = (recalled: number, asked: number): Recall => ({
  asked,
  recalled,
  recall: recalled / asked,
});

/**
 * Asks every question through `ranked`, which answers concept IRIs best first, and counts what
 * each finds of the `Answer`s it names among the first `depth`.
 */
export const recallAt = async (
  questions: readonly RecallQuestion[],
  landed: ReadonlyMap<string, string>,
  ranked: (question: RecallQuestion) => Promise<readonly string[]>,
  depth: number,
): Promise<Recalls> => {
  const counted = { every: 0, any: 0, reached: 0, named: 0 };
  for (const question of questions) {
    const top = new Set((await ranked(question)).slice(0, depth));
    const reached = question.answers.filter((key) => top.has(landed.get(key) ?? "")).length;
    counted.named += question.answers.length;
    counted.reached += reached;
    if (reached === question.answers.length) counted.every += 1;
    if (reached > 0) counted.any += 1;
  }
  return {
    everyAnswer: recallOf(counted.every, questions.length),
    anyAnswer: recallOf(counted.any, questions.length),
    byAnswer: recallOf(counted.reached, counted.named),
  };
};
