import { z } from "zod";

import { CONCEPT_WORDS as WORDS } from "./concept-words.ts";
import type { Concept } from "./knowledge-reads.ts";

type Frontmatter = Concept["frontmatter"];

/** Every key the page draws, or draws from the api's own field. Other fields shows the rest. */
export const READ_KEYS = [
  "title",
  "type",
  "description",
  "tags",
  "sources",
  "verified",
  "generated",
  "status",
  "stale_after",
  "iri",
] as const;

type ReadKey = (typeof READ_KEYS)[number];

const WRITTEN = z.string().trim().min(1);

const wordsAt = (frontmatter: Frontmatter, key: ReadKey): string | undefined =>
  WRITTEN.safeParse(frontmatter[key]).data;

export const titleOf = (frontmatter: Frontmatter): string =>
  wordsAt(frontmatter, "title") ?? WORDS.untitled;

export const kindOf = (frontmatter: Frontmatter): string | undefined =>
  wordsAt(frontmatter, "type");

export const descriptionOf = (frontmatter: Frontmatter): string | undefined =>
  wordsAt(frontmatter, "description");

export const staleAfterOf = (frontmatter: Frontmatter): string | undefined =>
  wordsAt(frontmatter, "stale_after");

const TAGS = z.array(z.string()).catch([]);

export const tagsOf = (frontmatter: Frontmatter): readonly string[] =>
  TAGS.parse(frontmatter["tags"] ?? []);

const GENERATION = z.object({ by: WRITTEN, at: WRITTEN.optional().catch(undefined) });

export type Generation = z.infer<typeof GENERATION>;

/** The platform writes `generated` as a list of one, because its frontmatter has no nested object. */
export const generatedOf = (frontmatter: Frontmatter): Generation | undefined => {
  const written = frontmatter["generated"];
  return GENERATION.safeParse(Array.isArray(written) ? written[0] : written).data;
};

const SCALAR = z.union([z.string(), z.number(), z.boolean()]);

const NAMES = z.array(z.string()).min(1);

const wordsOf = (value: Frontmatter[string]): string => {
  const scalar = SCALAR.safeParse(value);
  if (scalar.success) return String(scalar.data);
  const listed = NAMES.safeParse(value);
  return listed.success ? listed.data.join(", ") : JSON.stringify(value);
};

const READ: ReadonlySet<string> = new Set(READ_KEYS);

export const otherFieldsOf = (frontmatter: Frontmatter): readonly (readonly [string, string])[] =>
  Object.entries(frontmatter)
    .filter(([key]) => !READ.has(key))
    .map(([key, value]) => [key, wordsOf(value)] as const);
