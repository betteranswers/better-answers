import { z } from "zod";

import {
  conceptFrontmatter,
  ids,
  JUDGE_STATES,
  QUESTION_VERDICTS,
  recordMapState,
  type ConceptIri,
} from "@better-answers/schema";

import { findCursor } from "./cursor.ts";

const FIND_LIMIT_AT_MOST = 20;

export const holdsNoNul = (text: string): boolean => !text.includes("\u0000");

export const findInput = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .refine(holdsNoNul, "a query holds no NUL character")
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

const QUESTION_CHARACTERS_AT_MOST = 2_000;

const COLLECTIONS_AT_MOST = 20;

const COLLECTION_CHARACTERS_AT_MOST = 200;

export const askInput = z.object({
  question: z
    .string()
    .min(1)
    .max(QUESTION_CHARACTERS_AT_MOST)
    .refine(holdsNoNul, "a question holds no NUL character")
    .describe("The question, in the person's own words."),
  collections: z
    .array(
      z
        .string()
        .min(1)
        .max(COLLECTION_CHARACTERS_AT_MOST)
        .refine(holdsNoNul, "a collection's name holds no NUL character"),
    )
    .max(COLLECTIONS_AT_MOST)
    .default([])
    .describe(
      "The collections the question concerns, each spelled as an answer's `readableCollections` spells it. Leave it out to consider every collection you can read.",
    ),
});

export type AskInput = z.output<typeof askInput>;

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

const passageView = z.object({
  locator: z.string(),
  source: z.string(),
  text: z.string(),
  sensitivity: z.string(),
});

export type PassageView = z.infer<typeof passageView>;

export const passageViewOf = (passage: {
  readonly locator: string;
  readonly title: string;
  readonly text: string;
  readonly sensitivity: string;
}): PassageView => ({
  locator: passage.locator,
  source: passage.title,
  text: passage.text,
  sensitivity: passage.sensitivity,
});

const documentMatch = z.object({
  layer: z.literal("sources"),
  kind: z.literal("document"),
  title: z.string(),
  locator: z.string(),
  sensitivity: z.string(),
  openingLine: z
    .string()
    .describe(
      "The matched passage's first line with words, less any heading marks, cut short past 160 characters.",
    ),
});

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
          collection: z.string().nullable(),
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
    .regex(/\S/u)
    .exactOptional()
    .describe("The concept's own place in the source, such as a page; it opens nothing."),
  locator: z
    .string()
    .regex(/\S/u)
    .exactOptional()
    .describe("What opens the passage; absent where there is none you may read."),
  iri: z
    .string()
    .exactOptional()
    .describe("The concept this source names; absent where there is none you may read."),
});

export type Evidence<Iri extends string> = {
  readonly id?: string;
  readonly source: string;
  readonly at?: string;
  readonly locator?: string;
  readonly iri?: Iri;
};

const previewedConceptWith = <Trust extends z.ZodType>(trust: Trust) =>
  z.object({
    iri: z.string().describe("What `open` takes as `iri` to read the concept in full."),
    url: z.string().describe("The concept's page, for the person to open."),
    kind: z.string(),
    title: z.string().describe("For an `Answer`, the question it answered."),
    collection: z.string().nullable().describe("Null for a concept in no collection."),
    trust,
    trustWords: z.string(),
  });

const returnedConceptWith = <Trust extends z.ZodType>(trust: Trust) =>
  previewedConceptWith(trust).extend({
    body: z.string().describe("The `Answer`'s own words, to quote unchanged."),
    evidence: z.array(evidenceItem),
  });

const relatedConceptWith = <Trust extends z.ZodType>(trust: Trust) =>
  previewedConceptWith(trust).extend({
    body: z
      .string()
      .exactOptional()
      .describe(
        "An `Answer`'s own words when no judge ran or judging failed, to quote unchanged. Any other concept, and every `Answer` once the judge has run, comes without them: read it with `open` before writing from it.",
      ),
    evidence: z
      .array(evidenceItem)
      .exactOptional()
      .describe("An `Answer`'s sources, when its words come too."),
  });

export const answerOutputWith = <Trust extends z.ZodType>(trust: Trust) =>
  z.object({
    verdict: z.enum(QUESTION_VERDICTS),
    recordId: z.string().describe("The id of the record kept of this question."),
    answers: z
      .array(returnedConceptWith(trust))
      .describe("Every `Answer` a judge found to fit the question, as it stands."),
    judgeState: z
      .enum(JUDGE_STATES)
      .describe("How the judge stood: an `Answer` it did not judge is never a fit."),
    related: z
      .array(relatedConceptWith(trust))
      .describe(
        "The concepts that bear on the question, best first: an `Answer` as it stands when no judge ran or judging failed, and every other by its line.",
      ),
    conflicts: z.array(
      z.object({
        subject: z.string(),
        values: z.array(z.object({ value: z.string(), evidence: z.string() })),
      }),
    ),
    unmappedPassages: z.array(passageView),
    map: recordMapState,
    collections: z
      .array(z.string())
      .describe("The collections considered: those named, or every one you can read."),
    readableCollections: z.array(z.string()).describe("The collections you may name."),
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
            bodyLinks: z
              .array(
                z.object({
                  ordinal: z.number().int().nonnegative(),
                  address: z.string(),
                  target: z.string(),
                }),
              )
              .exactOptional()
              .describe(
                "Each link in the body that leads to a concept you may read: the `address` the body wrote, and the `target` to pass to `open` as `iri`. A link not listed here has nothing to open.",
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
