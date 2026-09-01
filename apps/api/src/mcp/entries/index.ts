import { z } from "zod";

import {
  ask,
  find,
  giveFeedback,
  open,
  renderAnswer,
  renderFeedback,
  renderFind,
  renderOpen,
} from "@better-answers/core/answering";

import { defineEntry, type Entry } from "./define.ts";

/**
 * The four entries (ADR 0018, 2026-08-31 amendment: `find`, `ask`, `open`,
 * `give_feedback`), in the one order `tools/list` returns them — registration order
 * is the SDK's listing order, and the spec asks for a deterministic list so a host's
 * prompt cache hits (research 80 row 9). Never sorted by anything mutable.
 *
 * Every schema is JSON Schema 2020-12 through zod v4's `toJSONSchema`; no key carries
 * `x-mcp-header` (research 80 row 13: a question is the person's own words).
 */

const trust = z.object({
  tier: z.enum(["unverified", "machine-confirmed", "human-reviewed"]),
  status: z.enum(["current", "changed-since-checked", "out-of-date", "draft", "deprecated"]),
  checkedBy: z.string().nullable(),
  checkedAt: z.string().nullable(),
});

const passage = z.object({
  locator: z.string(),
  source: z.string(),
  text: z.string(),
  sensitivity: z.string(),
});

const findEntry = defineEntry({
  name: "find",
  title: "Find in the company's knowledge",
  description:
    "Search the company's knowledge and return a preview of what matches: one line per hit with its kind, title and trust state. Use `open` to read a hit in full.",
  scopes: ["knowledge:read"],
  input: z.object({
    query: z.string().min(1).max(500).describe("What to look for, in the person's own words."),
    limit: z.number().int().min(1).max(20).default(5).describe("How many hits to preview."),
  }),
  output: z.object({
    query: z.string(),
    hits: z.array(
      z.object({
        iri: z.string(),
        kind: z.string(),
        title: z.string(),
        trust,
        bundle: z.string(),
        tags: z.array(z.string()),
      }),
    ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: (principal, tx, args) => find(principal, tx, args),
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
  run: (principal, tx, args) => ask(principal, tx, args),
  render: renderAnswer,
});

const openEntry = defineEntry({
  name: "open",
  title: "Open a concept, or the passage a citation rests on",
  description:
    "The verbatim fetch: a concept by its IRI (from a `find` hit or an `ask` citation) — its frontmatter, body, relations, trust state and evidence — or the passage a citation rests on, by its locator. Give one of the two. Quote what comes back; do not summarise it.",
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
    z.object({
      found: z.literal(true),
      concept: z
        .object({
          iri: z.string(),
          frontmatter: z.record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
          ),
          body: z.string(),
          relations: z.array(z.object({ kind: z.string(), target: z.string() })),
          trust,
          evidence: z.array(z.object({ locator: z.string(), source: z.string() })),
        })
        .optional(),
      passage: passage.optional(),
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
  run: (principal, tx, args) =>
    open(
      principal,
      tx,
      args.iri === undefined ? { locator: args.locator ?? "" } : { iri: args.iri },
    ),
  render: renderOpen,
});

const feedbackInput = z.discriminatedUnion("verdict", [
  z.object({
    iri: z.string().min(1).describe("The concept or answer the feedback is about."),
    verdict: z.literal("helpful"),
  }),
  z.object({
    iri: z.string().min(1).describe("The concept or answer the feedback is about."),
    verdict: z.literal("flag"),
    reason: z.enum(["wrong", "out-of-date", "incomplete", "should-not-have-shown"]),
    detail: z.string().max(2000).optional().describe("What was wrong, in the person's words."),
  }),
]);

const giveFeedbackEntry = defineEntry({
  name: "give_feedback",
  title: "Give feedback on an answer",
  description:
    "Record a reader's verdict on an answer or a concept: helpful, or a flag — wrong, out of date, incomplete, or should not have been shown — with what was wrong in their words. Called from a view's button or on the person's explicit ask; it is the surface's one write.",
  scopes: ["knowledge:read", "feedback:write"],
  input: z.object({
    iri: z.string().min(1).describe("The concept or answer the feedback is about."),
    verdict: z.enum(["helpful", "flag"]).describe("Helpful, or a flag with a reason."),
    reason: z
      .enum(["wrong", "out-of-date", "incomplete", "should-not-have-shown"])
      .optional()
      .describe("Required with a flag."),
    detail: z.string().max(2000).optional().describe("What was wrong, in the person's words."),
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
    const parsed = feedbackInput.safeParse(args);
    if (!parsed.success)
      throw new Error(
        "a flag needs a reason: wrong, out-of-date, incomplete or should-not-have-shown",
      );
    return giveFeedback(principal, tx, parsed.data);
  },
  render: renderFeedback,
});

/** The surface, in listing order. */
export const ENTRIES: readonly Entry<z.ZodObject, z.ZodType>[] = [
  findEntry,
  askEntry,
  openEntry,
  giveFeedbackEntry,
];
