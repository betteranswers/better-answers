import { z } from "zod";

import { CONCEPT_WORDS as WORDS } from "./concept-words.ts";
import type { Concept } from "./knowledge-reads.ts";

type Frontmatter = Concept["frontmatter"];

const WRITTEN = z.string().trim().min(1);

const wordsAt = (frontmatter: Frontmatter, key: string): string | undefined =>
  WRITTEN.safeParse(frontmatter[key]).data;

export const titleOf = (frontmatter: Frontmatter): string =>
  wordsAt(frontmatter, "title") ?? WORDS.untitled;

export const kindOf = (frontmatter: Frontmatter): string | undefined =>
  wordsAt(frontmatter, "type");

export const descriptionOf = (frontmatter: Frontmatter): string | undefined =>
  wordsAt(frontmatter, "description");

const TAGS = z.array(z.string()).catch([]);

export const tagsOf = (frontmatter: Frontmatter): readonly string[] =>
  TAGS.parse(frontmatter["tags"] ?? []);

const SHOWN_ELSEWHERE: ReadonlySet<string> = new Set([
  "title",
  "type",
  "description",
  "tags",
  "sources",
  "verified",
  "iri",
]);

const SCALAR = z.union([z.string(), z.number(), z.boolean()]);

const wordsOf = (value: Frontmatter[string]): string | undefined => {
  const scalar = SCALAR.safeParse(value);
  if (scalar.success) return String(scalar.data);
  const listed = z.array(z.string()).min(1).safeParse(value);
  return listed.success ? listed.data.join(", ") : undefined;
};

export const furtherKeysOf = (frontmatter: Frontmatter): readonly (readonly [string, string])[] =>
  Object.entries(frontmatter).flatMap(([key, value]) => {
    const words = SHOWN_ELSEWHERE.has(key) ? undefined : wordsOf(value);
    return words === undefined ? [] : [[key, words] as const];
  });
