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
  type FoundForText,
  type OpenedForText,
  type OpenResult,
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

const TYPE_KEY = "kind";

const typeField = { [TYPE_KEY]: z.string() };

type WireMatch<Match> = Match extends { readonly trust: Trust; readonly conceptType: string }
  ? Omit<Match, "trust" | "description" | "conceptType"> & {
      readonly trust: WireTrust;
      readonly [TYPE_KEY]: string;
    }
  : Match;

type WireFound = {
  readonly query: string;
  readonly hits: readonly WireMatch<FindMatch<string>>[];
  readonly nextCursor?: string;
};

const foundOnTheWire = ({ matches, ...found }: FindResult): WireFound => ({
  ...found,
  hits: matches.map((match) => {
    if (match.layer !== "bundles") return match;
    const { description: _description, conceptType, ...concept } = match;
    return { ...concept, [TYPE_KEY]: conceptType, trust: wireTrust(match.trust) };
  }),
});

const coreMatch = <Match extends { readonly trust: WireTrust; readonly [TYPE_KEY]: string }>({
  [TYPE_KEY]: conceptType,
  ...match
}: Match) => ({ ...match, conceptType, trust: coreTrust(match.trust) });

const foundInCore = ({ hits, ...found }: WireFound): FoundForText => ({
  ...found,
  matches: hits.map((match) => (match.layer === "bundles" ? coreMatch(match) : match)),
});

const openedOnTheWire = (opened: OpenResult<string>) => {
  if (!opened.found) return opened;
  const { concept, ...rest } = opened;
  if (concept === undefined) return rest;
  const { iri, frontmatter, body, relations, bodyLinks, trustWords } = concept;
  const { verifications, owner, usedIn, evidence } = concept;
  return {
    ...rest,
    concept: {
      iri,
      frontmatter,
      body,
      relations,
      bodyLinks,
      trust: wireTrust(concept.trust),
      trustWords,
      verifications,
      owner,
      usedIn,
      evidence,
    },
  };
};

type WireOpened = ReturnType<typeof openedOnTheWire>;

const openedInCore = (opened: WireOpened): OpenedForText => {
  if (!opened.found || !("concept" in opened)) return opened;
  return { ...opened, concept: { ...opened.concept, trust: coreTrust(opened.concept.trust) } };
};

const wired = <Value, Wired, Refused>(
  result: Result<Value, Refused>,
  wire: (value: Value) => Wired,
): Result<Wired, Refused> => (result.ok ? ok(wire(result.value)) : result);

const found = findOutputWith(trust, typeField);

const findEntry = defineEntry({
  road: "resolvers-transaction",
  name: "find",
  title: "Search Company Knowledge",
  description:
    "Search the company's knowledge and get a preview of the results, one line per match. Use it to find what the company knows about a topic, then call `open` to read a match in full. A concept's line gives its kind, title, collection, trust state and `iri`. A document that no concept covers is marked 'Not company knowledge'. Its line gives its title, its sensitivity, its `locator` and, in quotes, the first line of the passage that matched. If there are more matches, the result includes `nextCursor`. Send it back as `cursor` to get the next page.",
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
  render: (output) => renderFind(foundInCore(output)),
});

type WireAnswered = Omit<AnswerResult<string>, "answers" | "related"> & {
  readonly answers: readonly WireMatch<ReturnedConcept<string>>[];
  readonly related: readonly WireMatch<RelatedConcept<string>>[];
};

/** Some hosts give their model only the structured content, so it starts with the verdict, as the text does. */
const answeredOnTheWire = (
  origin: string,
  { verdict, recordId, answers, judgeState, related, ...answer }: AnswerResult,
): WireAnswered => {
  const wire = <Concept extends RelatedConcept>({ conceptType, ...concept }: Concept) => ({
    ...concept,
    [TYPE_KEY]: conceptType,
    url: `${origin}${concept.url}`,
    trust: wireTrust(concept.trust),
  });
  return {
    verdict,
    recordId,
    answers: answers.map(wire),
    judgeState,
    related: related.map(wire),
    ...answer,
  };
};

const answeredInCore = ({ answers, related, ...answer }: WireAnswered): AnswerResult<string> => {
  return { ...answer, answers: answers.map(coreMatch), related: related.map(coreMatch) };
};

const askEntryAt = (origin: string) =>
  defineEntry({
    road: "own-transaction",
    name: "ask",
    title: "Ask a Question",
    description:
      "Ask a question and get the company's answer, with the knowledge it is based on. Use it when the person asks something the company's knowledge may answer. The result starts with a `verdict`, then lists each `Answer` that a judge found answers the question under `answers`, and other related concepts under `related`. Quote each `Answer` under `answers` unchanged, and say who verified it. The concepts under `related` are related knowledge, not a judged answer. Write only what those concepts state, and name each one you use. An `Answer` under `related` comes in full when `judgeState` is `not-judged` or `judging-failed`. Quote it unchanged. Every other concept under `related` comes as one line. Read it with `open` and its `iri` before you write from it. Each concept is labelled with its collection. Never merge `Answer`s from different collections. Give each one under its own collection. An empty `conflicts` list means that no conflicts were looked for, not that there are none. A `verdict` of `refuse` means that nothing you can read is related to the question. Quote a passage marked 'Not company knowledge' and name its source. Do not summarise it. If the call is refused with `spending-limit-met`, the workspace has used up its AI spending for the month. Do not ask again. Tell the person that their Admin can ask better-answers to raise the limit. Each question is saved as a record, and the result includes its `recordId`. The person who asked and the workspace's Admins can read the record. The question's words are kept for twelve months. The verdict and the concepts returned are kept permanently. Who asked is kept until that person is erased.",
    scopes: ["knowledge:read"],
    input: z.object({
      question: askInput.shape.question,
      collections: askInput.shape.collections,
    }),
    output: answerOutputWith(trust, typeField),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    run: async (principal, steps, args, now) =>
      wired(await ask(principal, steps, args, now), (answer) => answeredOnTheWire(origin, answer)),
    render: (answer) => renderAnswer(answeredInCore(answer)),
  });

const openEntry = defineEntry({
  road: "resolvers-transaction",
  name: "open",
  title: "Open a Concept or Passage",
  description:
    "Read a concept or a passage in full. Use it before you write from a `find` match, a one-line concept from `ask`, or a cited passage. Give a concept's `iri` to get its frontmatter, body, relations, trust state and evidence, or give a passage's `locator` to get the passage text. Give one of the two, not both. An evidence item names its source. It has a `locator` or an `iri` only when it leads to something you can read. An imported concept's evidence often has neither, and an item with neither cannot be opened. An item's `at` is a place in the source, such as a page, and cannot be opened. A link in the body cannot be opened by its file path. `bodyLinks` gives the `iri` to open for each link you can read. Quote what `open` returns. Do not summarise it.",
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
  title: "Give Feedback on an Answer",
  description:
    "Save a person's feedback on an answer from `ask`, on the record of that question. Use it only when the person asks you to. The feedback is `helpful`, or a `flag` with a reason (wrong, out of date, incomplete, or should not have been shown) and a note in the person's words. Identify the question by the `recordId` from the `ask` result. Only the person who asked can give feedback on it. To flag a sentence you wrote from the answer, send that sentence and the concept you based it on as `disputed`. Each call saves a new verdict next to the earlier ones, so a call repeated after a timeout saves it twice. No one is notified of the feedback. The note, the disputed sentence and who gave the feedback are kept until that person is erased. The verdict, the reason and the disputed concept are kept permanently.",
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
