import { z } from "zod";

import { conceptFrontmatter } from "@better-answers/schema";

import {
  ask,
  find,
  giveFeedback,
  open,
  renderAnswer,
  renderFeedback,
  renderFind,
  renderOpen,
  type FeedbackReason,
} from "@better-answers/core/answering";
import { parse } from "@better-answers/core/kernel";

import { defineEntry, type Entry } from "./define.ts";

const trust = z.object({
  tier: z.enum(["unverified", "machine-confirmed", "human-reviewed"]),
  status: z.enum(["current", "changed-since-checked", "out-of-date", "draft", "deprecated"]),
  checkedBy: z.string().nullable(),
  checkedAt: z.string().nullable(),
  rider: z.enum(["imported", "source-moved-on"]).nullable(),
});

const passage = z.object({
  locator: z.string(),
  source: z.string(),
  text: z.string(),
  sensitivity: z.string(),
});

const hit = z.discriminatedUnion("layer", [
  z.object({
    layer: z.literal("bundles"),
    iri: z.string(),
    kind: z.string(),
    title: z.string(),
    trust,
    bundle: z.string(),
    tags: z.array(z.string()),
  }),
  z.object({
    layer: z.literal("sources"),
    kind: z.literal("document"),
    title: z.string(),
    locator: z.string(),
    sensitivity: z.string(),
  }),
]);

const findEntry = defineEntry({
  name: "find",
  title: "Find in the company's knowledge",
  description:
    "Search the company's knowledge and return a preview of what matches: one line per hit. A concept carries its kind, title and trust state; a document nothing on the map covers carries its title, the class it is held under and the marker 'Not company knowledge'. Use `open` to read a hit in full — a concept by its IRI, a document by the locator on its line.",
  scopes: ["knowledge:read"],
  input: z.object({
    query: z.string().min(1).max(500).describe("What to look for, in the person's own words."),
    limit: z.number().int().min(1).max(20).default(5).describe("How many hits to preview."),
  }),
  output: z.object({
    query: z.string(),
    hits: z.array(hit),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (principal, tx, args, now) => find(principal, tx, args, now),
  render: renderFind,
});

const askEntry = defineEntry({
  name: "ask",
  title: "Ask the company's knowledge a question",
  description:
    "Ask a question and get the company's cited answer, verdict first. Every claim carries the concept it rests on. A passage marked 'Not company knowledge' is to be quoted with its source named, never summarised.",
  scopes: ["knowledge:read"],
  input: z.object({
    question: z.string().min(1).max(2000).describe("The question, in the person's own words."),
  }),
  output: z.object({
    verdict: z.enum(["ok", "warn", "refuse"]),
    text: z.string(),
    citations: z.array(z.object({ iri: z.string(), url: z.string() })),
    conflicts: z.array(
      z.object({
        subject: z.string(),
        values: z.array(z.object({ value: z.string(), evidence: z.string() })),
      }),
    ),
    coverage: z.object({ asked: z.number().int(), answered: z.number().int() }),
    unmappedPassages: z.array(passage),
    map: z.discriminatedUnion("state", [
      z.object({ state: z.literal("live") }),
      z.object({ state: z.literal("as_of"), at: z.string() }),
      z.object({ state: z.literal("unavailable_since"), since: z.string() }),
    ]),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  run: async (principal, tx, args) => ask(principal, tx, args),
  render: renderAnswer,
});

const openEntry = defineEntry({
  name: "open",
  title: "Open a concept, or the passage a citation rests on",
  description:
    "The verbatim fetch: a concept by its IRI (from a `find` hit or an `ask` citation) — its frontmatter, body, relations, trust state and evidence, each evidence item with the locator that opens it — or the passage itself by that locator, which a document hit and a citation both carry. Give one of the two. Quote what comes back; do not summarise it.",
  scopes: ["knowledge:read"],
  input: z
    .object({
      iri: z.string().min(1).optional().describe("A concept's IRI."),
      locator: z
        .string()
        .min(1)
        .optional()
        .describe("A citation's locator, for the passage it rests on."),
    })
    .refine((value) => (value.iri === undefined) !== (value.locator === undefined), {
      message: "give an iri or a locator, not both and not neither",
    }),
  output: z.discriminatedUnion("found", [
    z
      .object({
        found: z.literal(true),
        concept: z
          .object({
            iri: z.string(),

            frontmatter: conceptFrontmatter,
            body: z.string(),
            relations: z.array(z.object({ kind: z.string(), target: z.string() })),
            trust,
            evidence: z.array(z.object({ locator: z.string(), source: z.string() })),
          })
          .optional(),
        passage: passage.optional(),
      })

      .refine((value) => (value.concept === undefined) !== (value.passage === undefined), {
        message: "a found result carries a concept or a passage, never both or neither",
      }),
    z.object({
      found: z.literal(false),
      iri: z.string().optional(),
      locator: z.string().optional(),
    }),
  ]),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (principal, tx, args, now) =>
    open(
      principal,
      tx,
      args.iri === undefined ? { locator: args.locator ?? "" } : { iri: args.iri },
      now,
    ),
  render: renderOpen,
});

const FLAG_REASONS = [
  "wrong",
  "out-of-date",
  "incomplete",
  "should-not-have-shown",
] as const satisfies readonly FeedbackReason[];

const feedbackIri = z.string().min(1).describe("The concept or answer the feedback is about.");

const feedbackDetail = z
  .string()
  .max(2000)
  .optional()
  .describe("What was wrong, in the person's words.");

const feedbackInput = z.discriminatedUnion("verdict", [
  z.object({ iri: feedbackIri, verdict: z.literal("helpful") }),
  z.object({
    iri: feedbackIri,
    verdict: z.literal("flag"),
    reason: z.enum(FLAG_REASONS),
    detail: feedbackDetail,
  }),
]);

const giveFeedbackEntry = defineEntry({
  name: "give_feedback",
  title: "Give feedback on an answer",
  description:
    "Record a reader's verdict on an answer or a concept: helpful, or a flag — wrong, out of date, incomplete, or should not have been shown — with what was wrong in their words. Called from a view's button or on the person's explicit ask; it is the surface's one write.",
  scopes: ["knowledge:read", "feedback:write"],
  // A flag with no reason is the act's own refusal, not a rule the flat wire shape could carry.
  input: z.object({
    iri: feedbackIri,
    verdict: z.enum(["helpful", "flag"]).describe("Helpful, or a flag with a reason."),
    reason: z.enum(FLAG_REASONS).optional().describe("Required with a flag."),
    detail: feedbackDetail,
  }),
  output: z.object({
    outcome: z.literal("received"),
    feedback: feedbackInput,
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  run: async (principal, tx, args) => {
    const parsed = parse(feedbackInput, args);
    if (!parsed.ok) return parsed;
    return giveFeedback(principal, tx, parsed.value);
  },
  render: renderFeedback,
});

export const ENTRIES: readonly Entry<z.ZodObject, z.ZodType>[] = [
  findEntry,
  askEntry,
  openEntry,
  giveFeedbackEntry,
];
