import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { ConceptIri } from "@better-answers/schema";

import { find } from "../src/answering/index.ts";
import { writeConcept } from "../src/concepts/index.ts";
import { attempt, err, ok, type Result, type UserPrincipal } from "../src/kernel/index.ts";
import type { visibilitySuite } from "./sourced-concept.ts";
import { answered } from "./suite-postgres.ts";
import { doorsOf, type Scenario } from "./workspace-with-bundle.ts";

type ReadingAs = ReturnType<typeof visibilitySuite>["reading"];

export const conceptsFoundBy =
  (reading: ReadingAs, person: UserPrincipal, now: Date) =>
  async (question: string): Promise<readonly string[]> => {
    const found = answered(
      await reading(person, (reader, tx) =>
        find(reader, tx, { query: question, limit: RECALL_DEPTH }, now),
      ),
    );
    return found.matches.flatMap((match) => (match.layer === "bundles" ? [match.iri] : []));
  };

export const worded = ({ recall, recalled, asked }: Recall, counted: string): string =>
  `${(recall * 100).toFixed(1)} %, for ${recalled} of ${asked} ${counted}`;

const RECALL_SET = fileURLToPath(new URL("./fixtures/recall-set.json", import.meta.url));

const BUYER_QUESTIONS = fileURLToPath(new URL("./fixtures/buyer-questions.json", import.meta.url));

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

export const readRecallSet = (path: string): Promise<Result<RecallSet, Error>> =>
  readAs(path, recallSet);

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
          source: answerKey,
          at: z.string().min(1),
          collection: answerKey.optional(),
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

export const readBuyerQuestions = (path: string): Promise<Result<BuyerQuestions, Error>> =>
  readAs(path, buyerQuestions);

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

export type RecallQuestion = {
  readonly question: string;
  readonly collection?: string | undefined;
  readonly answers: readonly string[];
};

export const paraphrasesOf = (set: RecallSet): readonly RecallQuestion[] =>
  answersOf(set).flatMap(({ key, group, paraphrases }) =>
    paraphrases.map((question) => ({ question, collection: group, answers: [key] })),
  );

/** One reading counted three ways. A cap is sized from `byAnswer`. */
export type Recalls = {
  readonly everyAnswer: Recall;
  readonly anyAnswer: Recall;
  readonly byAnswer: Recall;
};

const recallOf = (recalled: number, asked: number): Recall => ({
  asked,
  recalled,
  recall: recalled / asked,
});

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
