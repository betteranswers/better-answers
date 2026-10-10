import { z } from "zod";

import {
  ANSWER_VERDICTS,
  ask,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  find,
  findInput,
  findOutputWith,
  giveFeedback,
  open,
  openInput,
  openOutputWith,
  passageView,
  renderAnswer,
  renderFeedback,
  renderFind,
  renderOpen,
  TRUST_RIDERS,
  TRUST_STATUSES,
  TRUST_TIERS,
  type AnswerResult,
  type FindMatch,
  type FindResult,
  type OpenResult,
  type OpenView,
  type Trust,
} from "@better-answers/core/answering";
import { ok, parse, type Result } from "@better-answers/core/kernel";

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

type WireFound = {
  readonly query: string;
  readonly hits: readonly WireMatch<FindMatch<string>>[];
  readonly nextCursor?: string;
};

const foundOnTheWire = ({ matches, ...found }: FindResult): WireFound => ({
  ...found,
  hits: matches.map((match) =>
    match.layer === "bundles" ? { ...match, trust: wireTrust(match.trust) } : match,
  ),
});

const foundInCore = ({ hits, ...found }: WireFound): FindResult<string> => ({
  ...found,
  matches: hits.map((match) =>
    match.layer === "bundles" ? { ...match, trust: coreTrust(match.trust) } : match,
  ),
});

const openedOnTheWire = (opened: OpenResult<string>) => {
  if (!opened.found) return opened;
  const { concept, ...rest } = opened;
  if (concept === undefined) return rest;
  // The pane's words are the web page's; MCP's view keeps to `open`'s schema.
  const { iri, frontmatter, body, relations, bodyLinks, trustWords, evidence } = concept;
  const trusted = wireTrust(concept.trust);
  return {
    ...rest,
    concept: { iri, frontmatter, body, relations, bodyLinks, trust: trusted, trustWords, evidence },
  };
};

type WireOpened = ReturnType<typeof openedOnTheWire>;

const openedInCore = (opened: WireOpened): OpenView<string> => {
  if (!opened.found || !("concept" in opened)) return opened;
  return { ...opened, concept: { ...opened.concept, trust: coreTrust(opened.concept.trust) } };
};

const wired = <Value, Wired, Refused>(
  result: Result<Value, Refused>,
  wire: (value: Value) => Wired,
): Result<Wired, Refused> => (result.ok ? ok(wire(result.value)) : result);

const found = findOutputWith(trust);

const findEntry = defineEntry({
  name: "find",
  title: "Find in the company's knowledge",
  description:
    "Search the company's knowledge and preview what it finds: one line per match. A concept carries its kind, title and trust state; a document nothing on the map covers carries its title, the sensitivity it is held under and the marker 'Not company knowledge'. Use `open` to read a match in full — a concept by its `iri`, a document by the `locator` on its line. When more matches follow, the answer carries `nextCursor`; pass it back as `cursor` for the next page.",
  scopes: ["knowledge:read"],
  // oxlint-disable-next-line better-answers/mcp-entry-no-workspace-argument -- the answering slice's own schema; the emitted-schema test reads its keys
  input: findInput,
  output: z.object({
    query: found.shape.query,
    hits: found.shape.matches,
    nextCursor: found.shape.nextCursor,
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

/** Core cites a concept by its page's path; an outside client can only open it under our origin. */
const citedFrom = (origin: string, answer: AnswerResult): AnswerResult => ({
  ...answer,
  citations: answer.citations.map((citation) => ({ ...citation, url: `${origin}${citation.url}` })),
});

const askEntryAt = (origin: string) =>
  defineEntry({
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
      unmappedPassages: z.array(passageView),
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
    run: async (principal, tx, args) =>
      wired(await ask(principal, tx, args), (answer) => citedFrom(origin, answer)),
    render: renderAnswer,
  });

const openEntry = defineEntry({
  name: "open",
  title: "Open a concept, or the passage a citation rests on",
  description:
    "The verbatim fetch: a concept by its `iri` (from a `find` match or an `ask` citation) — its frontmatter, body, relations, trust state and evidence — or the passage itself by its `locator`, which a document match and a citation both carry. Give one of the two. Each evidence item names its source in the concept's own words, and carries the `locator` of a passage or the `iri` of a concept that opens it only where there is one you may read: an imported concept's evidence often has neither, and an item with neither has nothing to open. An item's `at` is the concept's own place in the source, such as a page, and opens nothing. A link in the body that names another concept's file cannot be opened by its path: `bodyLinks` gives the `iri` to open for each one you may read. Quote what comes back; do not summarise it.",
  scopes: ["knowledge:read"],
  // oxlint-disable-next-line better-answers/mcp-entry-no-workspace-argument -- the answering slice's own schema; the emitted-schema test reads its keys
  input: openInput,
  output: openOutputWith(trust),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async (principal, tx, args, now) =>
    wired(await open(principal, tx, args, now), openedOnTheWire),
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

/** `origin` is the product's public origin, which a citation's address is under. */
export const entriesAt = (origin: string): readonly Entry<z.ZodObject, z.ZodType>[] => [
  findEntry,
  askEntryAt(origin),
  openEntry,
  giveFeedbackEntry,
];
