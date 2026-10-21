import { z } from "zod";

import {
  answerOutputWith,
  ask,
  askInput,
  feedbackFields,
  feedbackInput,
  find,
  findInput,
  findOutputWith,
  giveFeedback,
  open,
  openInput,
  openOutputWith,
  renderAnswer,
  renderFeedback,
  renderFind,
  renderOpen,
  TRUST_RIDERS,
  TRUST_STATUSES,
  UNREVIEWED_TIERS,
  type AnswerResult,
  type FindMatch,
  type FindResult,
  type OpenResult,
  type OpenView,
  type RelatedConcept,
  type ReturnedConcept,
  type Trust,
} from "@better-answers/core/answering";
import { ok, parse, type Result } from "@better-answers/core/kernel";

import { defineEntry, type Entry } from "./define.ts";

const trustState = {
  status: z.enum(TRUST_STATUSES),
  checkedAt: z.string().nullable(),
  rider: z.enum(TRUST_RIDERS).nullable(),
};

const trust = z.discriminatedUnion("tier", [
  z.object({ tier: z.literal("human-reviewed"), checkedBy: z.string(), ...trustState }),
  z.object({
    tier: z.enum(UNREVIEWED_TIERS),
    checkedBy: z.string().nullable(),
    ...trustState,
  }),
]);

type WireTrust = z.infer<typeof trust>;

const wireTrust = ({ tier, status, verifiedBy, verifiedAt, rider }: Trust): WireTrust =>
  tier === "human-reviewed"
    ? { tier, status, checkedBy: verifiedBy, checkedAt: verifiedAt, rider }
    : { tier, status, checkedBy: verifiedBy, checkedAt: verifiedAt, rider };

const coreTrust = ({ tier, status, checkedBy, checkedAt, rider }: WireTrust): Trust =>
  tier === "human-reviewed"
    ? { tier, status, verifiedBy: checkedBy, verifiedAt: checkedAt, rider }
    : { tier, status, verifiedBy: checkedBy, verifiedAt: checkedAt, rider };

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
  road: "resolvers-transaction",
  name: "find",
  title: "Find in the company's knowledge",
  description:
    "Search the company's knowledge and preview what it finds: one line per match. A concept carries its kind, title and trust state; a document nothing on the map covers carries its title, the sensitivity it is held under, the marker 'Not company knowledge' and, in quotes after its `locator`, the opening line of the passage that matched. Use `open` to read a match in full — a concept by its `iri`, a document by the `locator` on its line. When more matches follow, the answer carries `nextCursor`; pass it back as `cursor` for the next page.",
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

type WireAnswered = Omit<AnswerResult<string>, "answers" | "related"> & {
  readonly answers: readonly WireMatch<ReturnedConcept<string>>[];
  readonly related: readonly WireMatch<RelatedConcept<string>>[];
};

const answeredOnTheWire = (
  origin: string,
  { answers, related, ...answer }: AnswerResult,
): WireAnswered => {
  const wire = <Concept extends RelatedConcept>(concept: Concept) => ({
    ...concept,
    url: `${origin}${concept.url}`,
    trust: wireTrust(concept.trust),
  });
  return { ...answer, answers: answers.map(wire), related: related.map(wire) };
};

const answeredInCore = ({ answers, related, ...answer }: WireAnswered): AnswerResult<string> => {
  const core = <Concept extends WireMatch<RelatedConcept<string>>>(concept: Concept) => ({
    ...concept,
    trust: coreTrust(concept.trust),
  });
  return { ...answer, answers: answers.map(core), related: related.map(core) };
};

/** A host may hand its assistant the text alone, so the record's id is written there too. */
const renderAsked = (answer: WireAnswered): string =>
  `${renderAnswer(answeredInCore(answer))}\n\nRecord of this question: ${answer.recordId}`;

const askEntryAt = (origin: string) =>
  defineEntry({
    road: "own-transaction",
    name: "ask",
    title: "Ask the company's knowledge a question",
    description:
      "Ask a question and get, verdict first, each `Answer` in the company's knowledge that a judge found answers it as asked, under `answers`, and the other concepts that bear on it, under `related`. Quote an `Answer` under `answers` unchanged, with who verified it. What is under `related` is related knowledge, not a judged answer: write only what those concepts state, name each one you use, and quote an `Answer` among them unchanged. `judgeState` is `judged` when the judge ran, `judging-failed` when it could not judge (its candidates are then under `related`), and `not-judged` when the workspace has no judge or no `Answer` was a candidate; an `Answer` no judge passed is never under `answers`. A refusal of `spending-limit-met` means the workspace's model spend for the month is used up: do not ask again, and tell the person their Admin can ask better-answers to raise it. An `Answer` comes back in full; any other concept comes back as one line, so read it with `open` and its `iri` before you write from it. Each concept is labelled with its collection, and `Answer`s under different collections are never merged: give each under its own. An empty `conflicts` list means no conflict was looked for, not that none exists. A verdict of `refuse` means nothing you can read bears on the question. A passage marked 'Not company knowledge' is to be quoted with its source named, never summarised. Each question is kept as a record, and the answer carries its `recordId`. The person who asked and the workspace's Admins may read it. The question's words are kept for twelve months; the verdict and which concepts were returned are kept for good, and who asked until that person is erased.",
    scopes: ["knowledge:read"],
    input: z.object({
      question: askInput.shape.question,
      collections: askInput.shape.collections,
    }),
    output: answerOutputWith(trust),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    run: async (principal, steps, args, now) =>
      wired(await ask(principal, steps, args, now), (answer) => answeredOnTheWire(origin, answer)),
    render: renderAsked,
  });

const openEntry = defineEntry({
  road: "resolvers-transaction",
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

const giveFeedbackEntry = defineEntry({
  road: "resolvers-transaction",
  name: "give_feedback",
  title: "Give feedback on an answer",
  description:
    "Store a person's verdict on an answer `ask` gave, on the record of that question: helpful, or a flag — wrong, out of date, incomplete, or should not have been shown — with a note in their words. Name the record by the `recordId` the answer carried; only the person who asked can give feedback on it. For a flag on a sentence you wrote from the answer, send that sentence and the concept it rested on as `disputed`. Call it on the person's explicit ask. Each call stores another verdict beside the last, so a call repeated after a timeout stores it twice. The feedback is kept with the record, and no one is notified of it. The note, the disputed sentence and who gave it are kept until that person is erased; the verdict, reason and disputed concept are kept for good.",
  scopes: ["knowledge:read", "feedback:write"],
  input: z.object({
    recordId: feedbackFields.shape.recordId,
    verdict: feedbackFields.shape.verdict,
    reason: feedbackFields.shape.reason,
    note: feedbackFields.shape.note,
    disputed: feedbackFields.shape.disputed,
  }),
  output: z.object({
    outcome: z.literal("stored"),
    feedback: feedbackInput,
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  run: async (principal, tx, args, now) => {
    const parsed = parse(feedbackInput, args);
    if (!parsed.ok) return parsed;
    return giveFeedback(principal, tx, parsed.value, now);
  },
  render: renderFeedback,
});

export const entriesAt = (origin: string): readonly Entry<z.ZodObject, z.ZodType>[] => [
  findEntry,
  askEntryAt(origin),
  openEntry,
  giveFeedbackEntry,
];
