import { z } from "zod";

import { conceptFrontmatter, ids, type ConceptIri } from "@better-answers/schema";

import { findCursor } from "./cursor.ts";

const FIND_LIMIT_AT_MOST = 20;

export const findInput = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    // Postgres refuses a NUL in text, which would fail the read rather than refuse the query.
    .refine((query) => !query.includes("\u0000"), "a query holds no NUL character")
    .describe("What to look for, in the person's own words."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(FIND_LIMIT_AT_MOST)
    .default(5)
    .describe("How many matches to preview."),
  cursor: findCursor
    .optional()
    .describe("The `nextCursor` of the page before, to read the page after it."),
});

export type FindInput = z.output<typeof findInput>;

export type OpenInput =
  | { readonly iri: ConceptIri; readonly locator?: undefined }
  | { readonly locator: string; readonly iri?: undefined };

/** An object, not a union, because an MCP client takes no union at an input's root. */
export const openInput = z
  .object({
    iri: ids.conceptIri
      .optional()
      .describe("The concept's identity, as a `find` line or an `ask` citation gives it."),
    locator: z
      .string()
      .min(1)
      .optional()
      .describe("The place of the passage a citation rests on, as the citation gives it."),
  })
  .refine(
    (value): value is OpenInput => (value.iri === undefined) !== (value.locator === undefined),
    {
      message: "give an `iri` or a `locator`, not both and not neither",
    },
  );

export const passageView = z.object({
  locator: z.string(),
  source: z.string(),
  text: z.string(),
  sensitivity: z.string(),
});

const documentMatch = z.object({
  layer: z.literal("sources"),
  kind: z.literal("document"),
  title: z.string(),
  locator: z.string(),
  sensitivity: z.string(),
});

/** `trust` is the one key the wire names its own way, so each edge hands in its schema. */
export const findOutputWith = <Trust extends z.ZodType>(trust: Trust) =>
  z.object({
    query: z.string(),
    matches: z.array(
      z.discriminatedUnion("layer", [
        z.object({
          layer: z.literal("bundles"),
          iri: z.string(),
          kind: z.string(),
          title: z.string(),
          trust,
          trustWords: z.string(),
          bundle: z.string(),
          tags: z.array(z.string()),
        }),
        documentMatch,
      ]),
    ),
    nextCursor: z.string().exactOptional(),
  });

const evidenceItem = z.object({
  id: z.string().exactOptional(),
  source: z.string(),
  at: z
    .string()
    .regex(/\S/)
    .exactOptional()
    .describe("The concept's own place in the source, such as a page; it opens nothing."),
  locator: z
    .string()
    .regex(/\S/)
    .exactOptional()
    .describe("What opens the passage; absent where there is none you may read."),
  iri: z
    .string()
    .exactOptional()
    .describe("The concept this source names; absent where there is none you may read."),
});

export const openOutputWith = <Trust extends z.ZodType>(trust: Trust) =>
  z.discriminatedUnion("found", [
    z
      .object({
        found: z.literal(true),
        concept: z
          .object({
            iri: z.string(),
            frontmatter: conceptFrontmatter,
            body: z.string(),
            relations: z.array(
              z.object({ kind: z.string(), target: z.string(), title: z.string() }),
            ),
            trust,
            trustWords: z.string(),
            evidence: z.array(evidenceItem),
          })
          .optional(),
        passage: passageView.optional(),
      })
      .refine((value) => (value.concept === undefined) !== (value.passage === undefined), {
        message: "a found result carries a concept or a passage, never both or neither",
      }),
    z.object({
      found: z.literal(false),
      iri: z.string().optional(),
      locator: z.string().optional(),
    }),
  ]);
