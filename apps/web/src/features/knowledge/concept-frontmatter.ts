import { z } from "zod";

import { dayWords } from "@/shared/words.ts";

import type { Concept } from "./knowledge-api.ts";
import { CONCEPT_WORDS as WORDS } from "./knowledge-words.ts";

type Frontmatter = Concept["frontmatter"];

const WRITTEN = z.string().trim().min(1);

const wordsAt = (frontmatter: Frontmatter, key: string): string | undefined =>
  WRITTEN.safeParse(frontmatter[key]).data;

/** A file need not title itself, and its identity is never what a page calls it. */
export const titleOf = (frontmatter: Frontmatter): string =>
  wordsAt(frontmatter, "title") ?? WORDS.untitled;

export const kindOf = (frontmatter: Frontmatter): string | undefined =>
  wordsAt(frontmatter, "type");

export const descriptionOf = (frontmatter: Frontmatter): string | undefined =>
  wordsAt(frontmatter, "description");

const TAGS = z.array(z.string()).catch([]);

export const tagsOf = (frontmatter: Frontmatter): readonly string[] =>
  TAGS.parse(frontmatter["tags"] ?? []);

const VERIFIED = z.array(z.object({ by: z.string(), at: z.string() })).catch([]);

/** OKF's prefix for a person's actor id; any other verifier is a process. */
const A_PERSON = "human:";

type VerifiedEvent = { readonly at: string; readonly byAPerson: boolean };

/** Who verified is said as a person or not: an actor's id is no word a reader meets. */
export const verifiedEventsOf = (frontmatter: Frontmatter): readonly VerifiedEvent[] =>
  VERIFIED.parse(frontmatter["verified"] ?? []).map(({ by, at }) => ({
    at,
    byAPerson: by.startsWith(A_PERSON),
  }));

/** The UK long form; a date the file wrote no parser reads is shown as the file wrote it. */
export const dayOf = (event: VerifiedEvent): string =>
  Number.isNaN(Date.parse(event.at)) ? event.at : dayWords(event.at);

/** Drawn elsewhere on the page, or an identity a reader never meets. */
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

/** The file's remaining keys under their own names, each a word or a list of words. */
export const furtherKeysOf = (frontmatter: Frontmatter): readonly (readonly [string, string])[] =>
  Object.entries(frontmatter).flatMap(([key, value]) => {
    const words = SHOWN_ELSEWHERE.has(key) ? undefined : wordsOf(value);
    return words === undefined ? [] : [[key, words] as const];
  });
