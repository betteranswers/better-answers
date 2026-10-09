import { z } from "zod";

import {
  ANSWER_VERDICTS,
  ask,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  find,
  giveFeedback,
  open,
  renderAnswer,
  renderFeedback,
  renderFind,
  renderOpen,
  TRUST_RIDERS,
  TRUST_STATUSES,
  TRUST_TIERS,
  type FindMatch,
  type FindResult,
  type OpenResult,
  type Trust,
} from "@better-answers/core/answering";
import { ok, parse, type Result } from "@better-answers/core/kernel";
import { conceptFrontmatter, ids } from "@better-answers/schema";

import { defineEntry, type Entry } from "./define.ts";

const trust = z.object({
  tier: z.enum(TRUST_TIERS),
  status: z.enum(TRUST_STATUSES),
  checkedBy: z.string().nullable(),
  checkedAt: z.string().nullable(),
  rider: z.enum(TRUST_RIDERS).nullable(),
});

type WireTrust = z.infer<typeof trust>;

/** Core says who verified a concept and when; the wire keeps the keys its clients read. */
const wireTrust = ({ tier, status, verifiedBy, verifiedAt, rider }: Trust): WireTrust => ({
  tier,
  status,
  checkedBy: verifiedBy,
  checkedAt: verifiedAt,
  rider,
});

const coreTrust = ({ tier, status, checkedBy, checkedAt, rider }: WireTrust): Trust => ({
  tier,
  status,
  verifiedBy: checkedBy,
  verifiedAt: checkedAt,
  rider,
});

type WireMatch<Match> = Match extends { readonly trust: Trust }
  ? Omit<Match, "trust"> & { readonly trust: WireTrust }
  : Match;

type WireFound = { readonly query: string; readonly hits: readonly WireMatch<FindMatch<string>>[] };

const foundOnTheWire = (found: FindResult): WireFound => ({
  query: found.query,
  hits: found.matches.map((match) =>
    match.layer === "bundles" ? { ...match, trust: wireTrust(match.trust) } : match,
  ),
});

const foundInCore = (found: WireFound): FindResult<string> => ({
  query: found.query,
  matches: found.hits.map((match) =>
    match.layer === "bundles" ? { ...match, trust: coreTrust(match.trust) } : match,
  ),
});

const openedOnTheWire = (opened: OpenResult<string>) => {
  if (!opened.found) return opened;
  const { concept, ...rest } = opened;
  return concept === undefined
    ? rest
    : { ...rest, concept: { ...concept, trust: wireTrust(concept.trust) } };
};

type WireOpened = ReturnType<typeof openedOnTheWire>;

const openedInCore = (opened: WireOpened): OpenResult<string> => {
  if (!opened.found || !("concept" in opened)) return opened;
  return { ...opened, concept: { ...opened.concept, trust: coreTrust(opened.concept.trust) } };
};

const wired = <Value, Wired, Refused>(
  result: Result<Value, Refused>,
  wire: (value: Value) => Wired,
): Result<Wired, Refused> => (result.ok ? ok(wire(result.value)) : result);

const passage = z.object({
  locator: z.string(),
  source: z.string(),
  text: z.string(),
  sensitivity: z.string(),
});

const match = z.discriminatedUnion("layer", [
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
    "Search the company's knowledge and preview what it finds: one line per match. A concept carries its kind, title and trust state; a document nothing on the map covers carries its title, the sensitivity it is held under and the marker 'Not company knowledge'. Use `open` to read a match in full — a concept by its `iri`, a document by the `locator` on its line.",
  scopes: ["knowledge:read"],
  input: z.object({
    query: z.string().min(1).max(500).describe("What to look for, in the person's own words."),
    limit: z.number().int().min(1).max(20).default(5).describe("How many matches to preview."),
  }),
  output: z.object({
    query: z.string(),
    hits: z.array(match),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (principal, tx, args, now) =>
    wired(await find(principal, tx, args, now), foundOnTheWire),
  render: (found) => renderFind(foundInCore(found)),
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
    verdict: z.enum(ANSWER_VERDICTS),
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
    "The verbatim fetch: a concept by its `iri` (from a `find` match or an `ask` citation) — its frontmatter, body, relations, trust state and evidence — or the passage itself by its `locator`, which a document match and a citation both carry. Give one of the two. Each evidence item names its source in the concept's own words, and carries the `locator` of a passage or the `iri` of a concept that opens it only where there is one you may read: an imported concept's evidence often has neither, and an item with neither has nothing to open. Quote what comes back; do not summarise it.",
  scopes: ["knowledge:read"],
  input: z
    .object({
      iri: z
        .string()
        .min(1)
        .optional()
        .describe("The concept's identity, as a `find` line or an `ask` citation gives it."),
      locator: z
        .string()
        .min(1)
        .optional()
        .describe("The place of the passage a citation rests on, as the citation gives it."),
    })
    .refine((value) => (value.iri === undefined) !== (value.locator === undefined), {
      message: "give an `iri` or a `locator`, not both and not neither",
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
            relations: z.array(
              z.object({ kind: z.string(), target: z.string(), title: z.string() }),
            ),
            trust,
            trustWords: z.string(),
            evidence: z.array(
              z.object({
                id: z.string().exactOptional(),
                source: z.string(),
                locator: z
                  .string()
                  .regex(/\S/)
                  .exactOptional()
                  .describe("What opens the passage; absent where there is none you may read."),
                iri: z
                  .string()
                  .exactOptional()
                  .describe(
                    "The concept this source names; absent where there is none you may read.",
                  ),
              }),
            ),
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
  run: async (principal, tx, args, now) => {
    if (args.iri === undefined) {
      return wired(
        await open(principal, tx, { locator: args.locator ?? "" }, now),
        openedOnTheWire,
      );
    }
    // No concept holds an iri that is malformed, so it answers as one nobody holds.
    const iri = ids.conceptIri.safeParse(args.iri);
    if (!iri.success) return ok(openedOnTheWire({ found: false, iri: args.iri }));
    return wired(await open(principal, tx, { iri: iri.data }, now), openedOnTheWire);
  },
  render: (opened) => renderOpen(openedInCore(opened)),
});

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
    reason: z.enum(FEEDBACK_REASONS),
    detail: feedbackDetail,
  }),
]);

const giveFeedbackEntry = defineEntry({
  name: "give_feedback",
  title: "Give feedback on an answer",
  description:
    "Record a reader's verdict on an answer or a concept: helpful, or a flag — wrong, out of date, incomplete, or should not have been shown — with what was wrong in their words. Called from a view's button or on the person's explicit ask; it is the server's one write.",
  scopes: ["knowledge:read", "feedback:write"],
  // A flag with no reason is the action's own refusal, not a rule the flat wire shape could carry.
  input: z.object({
    iri: feedbackIri,
    verdict: z.enum(FEEDBACK_VERDICTS).describe("Helpful, or a flag with a reason."),
    reason: z.enum(FEEDBACK_REASONS).optional().describe("Required with a flag."),
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
