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

const trustState = z.enum(["verified", "reviewed", "unverified", "stale"]);

const findEntry = defineEntry({
  name: "find",
  title: "Find in the company's knowledge",
  description:
    "Search the company's knowledge and return a preview of what matches: one line per hit with its kind, title and trust state. Use `open` to read a hit in full.",
  scope: "knowledge:read",
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
        trust: trustState,
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
  scope: "knowledge:read",
  input: z.object({
    question: z.string().min(1).max(2000).describe("The question, in the person's own words."),
  }),
  output: z.object({
    verdict: z.enum(["answered", "warn", "refuse"]),
    text: z.string(),
    citations: z.array(z.object({ iri: z.string(), url: z.string() })),
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
  title: "Open a concept",
  description:
    "Fetch one concept verbatim by its IRI, from a `find` hit or an `ask` citation: its frontmatter, body, relations, trust state and evidence. Quote it; do not summarise it.",
  scope: "knowledge:read",
  input: z.object({
    iri: z.string().min(1).describe("The concept's IRI, from a `find` hit or an `ask` citation."),
  }),
  output: z.discriminatedUnion("found", [
    z.object({
      found: z.literal(true),
      concept: z.object({
        iri: z.string(),
        frontmatter: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
        ),
        body: z.string(),
        relations: z.array(z.object({ kind: z.string(), target: z.string() })),
        trust: z.object({ state: trustState, verifiedAt: z.string().nullable() }),
        evidence: z.array(z.object({ locator: z.string(), source: z.string() })),
      }),
    }),
    z.object({ found: z.literal(false), iri: z.string() }),
  ]),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: (principal, tx, args) => open(principal, tx, args),
  render: renderOpen,
});

const giveFeedbackEntry = defineEntry({
  name: "give_feedback",
  title: "Give feedback on an answer",
  description:
    "Record that an answer or a concept was wrong, out of date, incomplete, or should not have been shown. Called from a view's button or on the person's explicit ask; it is the surface's one write.",
  scope: "feedback:write",
  input: z.object({
    iri: z.string().min(1).describe("The concept or answer the feedback is about."),
    reason: z.enum(["wrong", "out-of-date", "incomplete", "should-not-have-shown"]),
    detail: z.string().max(2000).optional().describe("What was wrong, in the person's words."),
  }),
  output: z.object({
    outcome: z.literal("received"),
    iri: z.string(),
    reason: z.enum(["wrong", "out-of-date", "incomplete", "should-not-have-shown"]),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  run: (principal, tx, args) => giveFeedback(principal, tx, args),
  render: renderFeedback,
});

/** The surface, in listing order. */
export const ENTRIES: readonly Entry<z.ZodObject, z.ZodType>[] = [
  findEntry,
  askEntry,
  openEntry,
  giveFeedbackEntry,
];
