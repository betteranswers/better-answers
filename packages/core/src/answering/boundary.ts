import { z } from "zod";

import {
  conceptFrontmatter,
  ids,
  JUDGE_STATES,
  QUESTION_VERDICTS,
  recordMapState,
  type ConceptIri,
} from "@better-answers/schema";

import { OWNED_VIA, VERIFIED_TIERS } from "../concepts/index.ts";
import { findCursor } from "./cursor.ts";

const FIND_LIMIT_AT_MOST = 20;

export const holdsNoNul = (text: string): boolean => !text.includes("\u0000");

export const findInput = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .refine(holdsNoNul, "a query must not contain a NUL character")
    .describe("The words to search for, as the person wrote them. Up to 500 characters."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(FIND_LIMIT_AT_MOST)
    .default(5)
    .describe(
      `The number of matches to return, from 1 to ${FIND_LIMIT_AT_MOST}. The default is 5.`,
    ),
  cursor: findCursor
    .optional()
    .describe(
      "The `nextCursor` value from the previous page of results. Send it to get the next page.",
    ),
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
    .refine(holdsNoNul, "a question must not contain a NUL character")
    .describe(
      `The question, as the person asked it. Up to ${QUESTION_CHARACTERS_AT_MOST.toLocaleString("en-GB")} characters.`,
    ),
  collections: z
    .array(
      z
        .string()
        .min(1)
        .max(COLLECTION_CHARACTERS_AT_MOST)
        .refine(holdsNoNul, "a collection's name must not contain a NUL character"),
    )
    .max(COLLECTIONS_AT_MOST)
    .default([])
    .describe(
      "The names of the collections to search, spelled exactly as in `readableCollections`. Leave it out to search every collection you can read.",
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
      .describe("The concept's `iri`, copied from a `find` result or an `ask` result."),
    locator: z
      .string()
      .min(1)
      .optional()
      .describe("The `locator` of a passage, copied from a document match or an evidence item."),
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
      "The first line of text in the matched passage, without heading marks. Lines longer than 160 characters are cut short.",
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
    .describe(
      "Where in the source the concept comes from, such as a page number. You cannot open it.",
    ),
  locator: z
    .string()
    .regex(/\S/u)
    .exactOptional()
    .describe(
      "Pass this to `open` to read the passage. Missing when there is no passage you can read.",
    ),
  iri: z
    .string()
    .exactOptional()
    .describe(
      "Pass this to `open` to read the concept this evidence names. Missing when there is no concept you can read.",
    ),
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
    iri: z.string().describe("Pass this to `open` as `iri` to read the whole concept."),
    url: z.string().describe("A link to the concept's page, for the person to open."),
    kind: z.string(),
    title: z
      .string()
      .describe("The concept's title. For an `Answer`, this is the question it answers."),
    collection: z
      .string()
      .nullable()
      .describe("The concept's collection, or null if it is in no collection."),
    trust,
    trustWords: z.string(),
  });

const returnedConceptWith = <Trust extends z.ZodType>(trust: Trust) =>
  previewedConceptWith(trust).extend({
    body: z.string().describe("The full text of the `Answer`. Quote it unchanged."),
    evidence: z.array(evidenceItem),
  });

const relatedConceptWith = <Trust extends z.ZodType>(trust: Trust) =>
  previewedConceptWith(trust).extend({
    body: z
      .string()
      .exactOptional()
      .describe(
        "The full text of an `Answer` when `judgeState` is `not-judged` or `judging-failed`. Quote it unchanged. Other concepts, and every `Answer` when `judgeState` is `judged`, have no `body`. Read them with `open` before you write from them.",
      ),
    evidence: z
      .array(evidenceItem)
      .exactOptional()
      .describe("The sources of an `Answer`. Present only when `body` is present."),
  });

export const answerOutputWith = <Trust extends z.ZodType>(trust: Trust) =>
  z.object({
    verdict: z.enum(QUESTION_VERDICTS),
    recordId: z
      .string()
      .describe("The id of the saved record of this question. `give_feedback` takes it."),
    answers: z
      .array(returnedConceptWith(trust))
      .describe("Each `Answer` that the judge found answers the question as asked, in full."),
    judgeState: z
      .enum(JUDGE_STATES)
      .describe(
        "Whether the judge ran. `judged`: it ran. `judging-failed`: it could not judge, so its candidates are under `related`. `not-judged`: the workspace has no judge, or no `Answer` was a candidate. Only a judged `Answer` appears under `answers`.",
      ),
    related: z
      .array(relatedConceptWith(trust))
      .describe(
        "Other concepts related to the question, best match first. An `Answer` comes in full when `judgeState` is `not-judged` or `judging-failed`. Every other concept comes as one line.",
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
      .describe(
        "The collections searched: the ones named in `collections`, or every collection you can read.",
      ),
    readableCollections: z
      .array(z.string())
      .describe("The collections you can read. Use these names in `collections`."),
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
                "The links in the body that lead to a concept you can read. `address` is the link as the body writes it, and `target` is the `iri` to pass to `open`. A link that is not listed here cannot be opened.",
              ),
            trust,
            trustWords: z.string(),
            verifications: z
              .array(
                z.object({
                  tier: z.enum(VERIFIED_TIERS),
                  actor: z.string(),
                  name: z.string().nullable(),
                  at: z.string(),
                }),
              )
              .describe(
                "Every verification of the concept, newest first. The newest one sets `trust`. `name` is the person who verified it, and is null for an agent.",
              ),
            owner: z
              .object({
                personId: z.string(),
                name: z.string(),
                via: z.enum(OWNED_VIA),
              })
              .nullable()
              .describe(
                "The person answerable for keeping the concept verified: its own owner, or its collection's owner when `via` is `collection`. Null when nobody owns it.",
              ),
            usedIn: z
              .object({
                guides: z.number().int().nonnegative(),
                answers: z.number().int().nonnegative(),
              })
              .describe("How many guides and answered questions you can read use the concept."),
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
