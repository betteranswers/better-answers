import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { ConceptIri } from "@better-answers/schema";

import { writeConcept } from "../src/concepts/index.ts";
import { attempt, err, ok, type Result } from "../src/kernel/index.ts";
import { doorsOf, type Scenario } from "./workspace-with-bundle.ts";

export const RECALL_SET = fileURLToPath(new URL("./fixtures/recall-set.json", import.meta.url));

/** How far down a ranking the master `Answer` may sit and still count as recalled. */
export const RECALL_DEPTH = 10;

const recallAnswer = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]+$/),
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

/** The set at `path`, refused when it cannot be read, is not JSON, or holds no answer. */
export const readRecallSet = async (path: string): Promise<Result<RecallSet, Error>> => {
  const text = await attempt(() => readFile(path, "utf8"));
  if (!text.ok) return text;
  const json = await attempt(async (): Promise<unknown> => JSON.parse(text.value));
  if (!json.ok) return json;
  const parsed = recallSet.safeParse(json.value);
  return parsed.success ? ok(parsed.data) : err(new Error(z.prettifyError(parsed.error)));
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

/**
 * Asks every paraphrase through `ranked`, which answers concept IRIs best first, and counts the
 * paraphrases whose master `Answer` is among the first `RECALL_DEPTH`.
 */
export const recallAt = async (
  set: RecallSet,
  landed: ReadonlyMap<string, ConceptIri>,
  ranked: (question: string) => Promise<readonly string[]>,
): Promise<Recall> => {
  let asked = 0;
  let recalled = 0;
  for (const { key, paraphrases } of answersOf(set)) {
    const master = landed.get(key);
    for (const paraphrase of paraphrases) {
      const top = (await ranked(paraphrase)).slice(0, RECALL_DEPTH);
      asked += 1;
      if (master !== undefined && top.includes(master)) recalled += 1;
    }
  }
  return { asked, recalled, recall: recalled / asked };
};
