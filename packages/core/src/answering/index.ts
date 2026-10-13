import { z } from "zod";

import type {
  ConceptIri,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  JudgeState,
  MatchStrength,
  QuestionVerdict,
} from "@better-answers/schema";

import type { ConceptRead, Frontmatter } from "../concepts/index.ts";
import {
  findConcepts,
  readConcept,
  trustOf,
  trustWords,
  ukLongDate,
  type OpenedConcept,
  type Trust,
} from "../concepts/index.ts";
import {
  admit,
  ANY_ROLE,
  declareAction,
  err,
  NOT_FOUND,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { findPassages, parseLocator, passageAt, type PassageMatch } from "../sources/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import {
  askInput,
  findInput,
  openInput,
  passageViewOf,
  type AskInput,
  type Evidence,
  type FindInput,
  type OpenInput,
  type PassageView,
} from "./boundary.ts";
import { cursorOf, type FindPosition, type FindRun } from "./cursor.ts";
import {
  answerPlanned,
  ASK_CAPS,
  type AskCaps,
  type MapState,
  type PlannedAnswer,
  type ReadStep,
  type ReturnedConcept,
} from "./plan.ts";
import type { RecordCompletion, RecordOpening } from "./record.ts";

export {
  answerOutputWith,
  askInput,
  findInput,
  findOutputWith,
  openInput,
  openOutputWith,
  type AskInput,
  type FindInput,
  type OpenInput,
} from "./boundary.ts";
export { findCursor, type FindPosition } from "./cursor.ts";
export {
  ASK_CAPS,
  type AskCaps,
  type MapState,
  type PlannedAnswer,
  type ReadStep,
  type ReturnedConcept,
} from "./plan.ts";
export { completeRecord, openRecord } from "./record.ts";

export {
  TRUST_RIDERS,
  TRUST_STATUSES,
  TRUST_TIERS,
  trustWords,
  type Trust,
  type TrustStatus,
} from "../concepts/index.ts";

export const NOT_COMPANY_KNOWLEDGE = "Not company knowledge";

const NO_COLLECTION = "No collection";

/** `Iri` is `string` where an iri is only read as text, as a renderer reads it. */
type ConceptMatch<Iri extends string> = {
  readonly layer: "bundles";
  readonly iri: Iri;
  readonly kind: string;
  readonly title: string;
  readonly trust: Trust;
  readonly trustWords: string;
  /** Null for a concept in no collection. */
  readonly collection: string | null;
  readonly tags: readonly string[];
};

type DocumentMatch = {
  readonly layer: "sources";
  readonly kind: "document";
  readonly title: string;
  readonly locator: string;
  readonly sensitivity: string;
};

export type FindMatch<Iri extends string = ConceptIri> = ConceptMatch<Iri> | DocumentMatch;

export type FindResult<Iri extends string = ConceptIri> = {
  readonly query: string;
  readonly matches: readonly FindMatch<Iri>[];

  readonly nextCursor?: string;
};

export type { FrontmatterValue } from "../concepts/index.ts";

type ConceptView<Iri extends string> = {
  readonly iri: Iri;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly relations: readonly {
    readonly kind: string;
    readonly target: Iri;
    readonly title: string;
  }[];
  /** Each link in the body that leads to a concept the reader may read; `open` always answers it. */
  readonly bodyLinks?: readonly {
    readonly ordinal: number;
    readonly address: string;
    readonly target: Iri;
  }[];
  readonly trust: Trust;
  readonly trustWords: string;
  readonly evidence: readonly Evidence<Iri>[];
};

type Opened<Iri extends string, View> =
  | {
      readonly found: true;
      readonly concept?: View | undefined;
      readonly passage?: PassageView | undefined;
    }
  | {
      readonly found: false;
      readonly iri?: Iri | undefined;
      readonly locator?: string | undefined;
    };

/** What MCP and the renderer read of an open. */
export type OpenView<Iri extends string = ConceptIri> = Opened<Iri, ConceptView<Iri>>;

/** The pane's words, which the web's concept page leads and ends its sources with. */
type PaneWords = Pick<ConceptRead["pane"], "access" | "lead" | "next">;

export type OpenResult<Iri extends string = ConceptIri> = Opened<
  Iri,
  ConceptView<Iri> & PaneWords & Required<Pick<ConceptView<Iri>, "bodyLinks">>
>;

/** What `ask` answers: the answer as planned, and the id of the record kept of the question. */
export type AnswerResult<Iri extends string = ConceptIri> = PlannedAnswer<Iri> & {
  readonly recordId: string;
};

const NOT_ANSWERED = "Not answered from the company's knowledge.";

export { FEEDBACK_REASONS, FEEDBACK_VERDICTS } from "@better-answers/schema";
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

export type FeedbackInput =
  | { readonly iri: string; readonly verdict: Extract<FeedbackVerdict, "helpful"> }
  | {
      readonly iri: string;
      readonly verdict: Extract<FeedbackVerdict, "flag">;
      readonly reason: FeedbackReason;
      readonly detail?: string | undefined;
    };

export type FeedbackReceipt = {
  readonly outcome: "received";
  readonly feedback: FeedbackInput;
};

const tagsOf = (frontmatter: Frontmatter): readonly string[] => {
  const tags = frontmatter["tags"];
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
};

type Positioned<Match> = { readonly match: Match; readonly position: FindPosition };

type RunReader<Match> = (
  limit: number,
  after: FindPosition | undefined,
) => Promise<Result<readonly Positioned<Match>[], Error>>;

type Search = {
  readonly principal: UserPrincipal;
  readonly tx: Tx;
  readonly query: string;
};

const conceptRun =
  ({ principal, tx, query }: Search, run: MatchStrength): RunReader<OpenedConcept> =>
  async (limit, after) => {
    const found = await findConcepts(principal, tx, {
      query,
      strength: run,
      limit,
      after: after?.run === run ? after.bound : undefined,
    });
    if (!found.ok) return err(found.error);
    return ok(
      found.value.map(({ concept, bound }) => ({ match: concept, position: { run, bound } })),
    );
  };

const passageRun =
  ({ principal, tx, query }: Search): RunReader<PassageMatch> =>
  async (limit, after) => {
    const found = await findPassages(principal, tx, {
      query,
      limit,
      after: after?.run === "passages" ? after.bound : undefined,
    });
    if (!found.ok) return err(found.error);
    return ok(
      found.value.map(({ passage, bound }) => ({
        match: passage,
        position: { run: "passages" as const, bound },
      })),
    );
  };

type Page<Match> = { readonly matches: readonly Match[]; readonly next: FindPosition | undefined };

/** Reads one row past `limit`, so a page names where it ended only when more follow. */
const pageOf = async <Match>(
  runs: readonly (readonly [FindRun, RunReader<Match>])[],
  limit: number,
  after: FindPosition | undefined,
): Promise<Result<Page<Match>, Error>> => {
  const read: Positioned<Match>[] = [];
  const from = after === undefined ? 0 : runs.findIndex(([run]) => run === after.run);
  for (const [, reader] of runs.slice(from)) {
    if (read.length > limit) break;
    const more = await reader(limit + 1 - read.length, after);
    if (!more.ok) return err(more.error);
    read.push(...more.value);
  }
  const page = read.slice(0, limit);
  return ok({
    matches: page.map(({ match }) => match),
    next: read.length > limit ? page.at(-1)?.position : undefined,
  });
};

const mappedRun =
  <From, To>(reader: RunReader<From>, to: (from: From) => To): RunReader<To> =>
  async (limit, after) => {
    const read = await reader(limit, after);
    if (!read.ok) return err(read.error);
    return ok(read.value.map(({ match, position }) => ({ match: to(match), position })));
  };

const findAction = declareAction({
  admits: ANY_ROLE,
  input: findInput,
  refuses: ["role-forbids"],
});

export type FindRefusal = RefusalOf<typeof findAction> | Error;

/**
 * Concepts holding at least half the query's words, then passages, then concepts holding fewer,
 * `limit` to a page, after `cursor` when given. `now` decides which concepts are past their shelf
 * life.
 */
export const find = async (
  principal: UserPrincipal,
  tx: Tx,
  input: FindInput,
  now: Date,
): Promise<Result<FindResult, FindRefusal>> => {
  const admitted = admit(findAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const search = { principal: admitted.value, tx, query: input.query };
  const toConcept = (concept: OpenedConcept) => conceptMatchOf(concept, now);
  const page = await pageOf<FindMatch>(
    [
      ["strong", mappedRun(conceptRun(search, "strong"), toConcept)],
      ["passages", mappedRun(passageRun(search), documentMatchOf)],
      ["weak", mappedRun(conceptRun(search, "weak"), toConcept)],
    ],
    input.limit,
    input.cursor,
  );
  if (!page.ok) return err(page.error);
  const { matches, next } = page.value;
  const found: FindResult = { query: input.query, matches };
  return ok(next === undefined ? found : { ...found, nextCursor: cursorOf(next) });
};

const conceptMatchOf = (concept: OpenedConcept, now: Date): ConceptMatch<ConceptIri> => {
  const trust = trustOf(concept, now);
  return {
    layer: "bundles",
    iri: concept.iri,
    kind: concept.kind,
    title: concept.title,
    trust,
    trustWords: trustWords(trust),
    collection: concept.collection,
    tags: tagsOf(concept.frontmatter),
  };
};

const documentMatchOf = (match: PassageMatch): DocumentMatch => ({
  layer: "sources",
  kind: "document",
  title: match.title,
  locator: match.locator,
  sensitivity: match.sensitivity,
});

const openAction = declareAction({
  admits: ANY_ROLE,
  input: openInput,
  refuses: ["role-forbids"],
});

export type OpenRefusal = RefusalOf<typeof openAction> | Error;

const passageOpened = async (
  reader: UserPrincipal,
  tx: Tx,
  asked: string,
): Promise<Result<OpenResult, Error>> => {
  const passage = await passageAt(reader, tx, asked);
  if (!passage.ok) {
    return passage.error === NOT_FOUND ? ok({ found: false, locator: asked }) : err(passage.error);
  }
  return ok({ found: true, passage: passageViewOf(passage.value) });
};

const conceptOpened = async (
  reader: UserPrincipal,
  tx: Tx,
  named: ConceptIri,
  now: Date,
): Promise<Result<OpenResult, Error>> => {
  const concept = await readConcept(reader, tx, named, {
    passageAt: (locator) => passageAt(reader, tx, locator),
    namesPassage: (locator) => parseLocator(locator).ok,
    now,
  });
  if (!concept.ok) return err(concept.error);
  if (concept.value === undefined) return ok({ found: false, iri: named });

  const {
    iri,
    frontmatter,
    body,
    relations,
    bodyLinks,
    trust,
    trustWords: words,
    pane,
  } = concept.value;
  return ok({
    found: true,
    concept: {
      iri,
      frontmatter,
      body,
      relations,
      bodyLinks,
      trust,
      trustWords: words,
      evidence: pane.evidence,
      access: pane.access,
      lead: pane.lead,
      next: pane.next,
    },
  });
};

/** A concept or passage that is not there answers `found: false`, not an error. */
export const open = async (
  principal: UserPrincipal,
  tx: Tx,
  input: OpenInput,
  now: Date,
): Promise<Result<OpenResult, OpenRefusal>> => {
  const admitted = admit(openAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  return input.iri === undefined
    ? passageOpened(admitted.value, tx, input.locator)
    : conceptOpened(admitted.value, tx, input.iri, now);
};

const askAction = declareAction({
  admits: ANY_ROLE,
  input: askInput,
  refuses: ["role-forbids"],
});

export type AskRefusal = RefusalOf<typeof askAction> | Error;

/**
 * `ask` is handed these in place of a door. Its transport runs each in its own transaction, so
 * none stays open across a later step.
 */
export type AskSteps<Refused = never> = {
  /** Commits before it answers: a question refused later is still on record. */
  readonly openRecord: (
    opening: Omit<RecordOpening, "transport">,
  ) => Promise<Result<{ readonly recordId: string }, Refused | Error>>;
  readonly read: ReadStep<Refused>;
  readonly completeRecord: (
    completion: Omit<RecordCompletion, "completedAt" | "drafted">,
  ) => Promise<Result<void, Refused | Error>>;
};

/**
 * What `ask` would answer, read through `read` alone: no record is opened, so the answer carries
 * no record's id.
 */
export const planAnswer = async <Refused = never>(
  principal: UserPrincipal,
  read: ReadStep<Refused>,
  input: AskInput,
  now: Date,
  caps: AskCaps = ASK_CAPS,
): Promise<Result<PlannedAnswer, AskRefusal | Refused>> => {
  const admitted = admit(askAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const plan = await answerPlanned(admitted.value, read, input, now, caps);
  return plan.ok ? ok(plan.value.answer) : plan;
};

/**
 * Opens the question's record, reads what bears on it, and completes the record with what it
 * returns. No model is called: every `Answer` it finds is related knowledge, and no judge ran.
 * `now` decides which concepts are past their shelf life.
 */
export const ask = async <Refused = never>(
  principal: UserPrincipal,
  steps: AskSteps<Refused>,
  input: AskInput,
  now: Date,
  caps: AskCaps = ASK_CAPS,
): Promise<Result<AnswerResult, AskRefusal | Refused>> => {
  const admitted = admit(askAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const { question, collections } = input;
  const opened = await steps.openRecord({ question, collections, askedAt: now });
  if (!opened.ok) return opened;
  const { recordId } = opened.value;
  const plan = await answerPlanned(admitted.value, steps.read, input, now, caps);
  if (!plan.ok) return plan;
  const { answer, concepts } = plan.value;
  const completed = await steps.completeRecord({
    recordId,
    verdict: answer.verdict,
    judgeState: answer.judgeState,
    concepts,
    unmappedPassages: answer.unmappedPassages,
  });
  if (!completed.ok) return completed;
  return ok({ ...answer, recordId });
};

const giveFeedbackAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<FeedbackInput>(),
  refuses: ["role-forbids"],
});

/** Keeps nothing: the receipt echoes the input. */
export const giveFeedback = async (
  principal: UserPrincipal,
  _tx: Tx,
  input: FeedbackInput,
): Promise<Result<FeedbackReceipt, RefusalOf<typeof giveFeedbackAction>>> => {
  const admitted = admit(giveFeedbackAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  return ok({ outcome: "received", feedback: input });
};

const findLine = (match: FindMatch<string>): string =>
  match.layer === "bundles"
    ? `${match.kind} · ${match.title} · ${match.collection ?? NO_COLLECTION} · ${match.trustWords} · ${match.iri}`
    : `${match.kind} · ${match.title} · ${NOT_COMPANY_KNOWLEDGE} · ${match.sensitivity} · ${match.locator}`;

/** A client may read only the text, so the way to the next page is written out too. */
export const renderFind = (result: FindResult<string>): string => {
  if (result.matches.length === 0) return "Nothing in the company's knowledge matches that.";
  const lines = result.matches.map(findLine);
  return result.nextCursor === undefined
    ? lines.join("\n")
    : [...lines, "", `More follow: call find again with cursor ${result.nextCursor}`].join("\n");
};

/** Every line quoted: a document's own line never reads as a heading or a concept of the answer. */
const quoted = (text: string): readonly string[] => text.split(/\r?\n/).map((line) => `> ${line}`);

export const renderOpen = (result: OpenView<string>): string => {
  if (!result.found) {
    return result.iri === undefined
      ? `No passage at ${result.locator ?? "that link"}.`
      : `No concept at ${result.iri}.`;
  }
  if (result.passage !== undefined) {
    const { passage } = result;
    return [
      ...quoted(passage.text),
      "",
      `— ${passage.source} (${passage.locator}) · ${passage.sensitivity}`,
    ].join("\n");
  }
  return result.concept === undefined ? "Nothing to show." : conceptText(result.concept);
};

const listed = (heading: string, lines: readonly string[]): readonly string[] =>
  lines.length === 0 ? [] : ["", heading, ...lines];

const evidenceLines = (evidence: readonly Evidence<string>[]): readonly string[] =>
  evidence.map(({ source, at, locator, iri }) => {
    const named = at === undefined ? source : `${source}, ${at}`;
    const opens = locator ?? iri;
    return opens === undefined ? `- ${named}` : `- ${named} (${opens})`;
  });

const conceptText = (concept: ConceptView<string>): string => {
  const title =
    typeof concept.frontmatter["title"] === "string" ? concept.frontmatter["title"] : concept.iri;
  const evidence = evidenceLines(concept.evidence);
  const related = concept.relations.map(
    ({ kind, title: named, target }) => `- ${kind} · ${named} · ${target}`,
  );
  const linked = new Map((concept.bodyLinks ?? []).map(({ address, target }) => [address, target]));
  return [
    `# ${title}`,
    "",
    concept.body.trimEnd(),
    "",
    `_${concept.trustWords}_`,
    ...listed("Evidence:", evidence),
    ...listed("Related:", related),
    ...listed(
      "Links in the body:",
      [...linked].map(([address, target]) => `- ${address} · ${target}`),
    ),
  ].join("\n");
};

export const mapWords = (map: MapState): string => {
  switch (map.state) {
    case "live":
      return "map as of now";
    case "as_of":
      return `map as of ${ukLongDate(map.at)}`;
    case "unavailable_since":
      return `map unavailable since ${ukLongDate(map.since)}`;
  }
};

const ANSWER_KIND = "Answer";

/** The related line tells an assistant what to do, and never says the question was answered. */
const VERDICT_LINES = {
  ok: "**Answered from the company's knowledge.**",
  warn: "**Answered with a warning for your role.**",
  refuse: `**${NOT_ANSWERED}**`,
  related:
    "**Related knowledge, not an answer.** Write only what these concepts state, naming each one you use, and quote an `Answer` word for word.",
} satisfies Record<QuestionVerdict, string>;

const JUDGE_WORDS = {
  "not-judged": "Not judged",
  judged: "Judged",
  "judging-failed": "Judging failed",
} satisfies Record<JudgeState, string>;

const namedOrNone = (collections: readonly string[]): string =>
  collections.length === 0 ? "none" : collections.join(", ");

const returnedText = (concept: ReturnedConcept<string>): readonly string[] => [
  "",
  `## ${concept.kind} · ${concept.collection ?? NO_COLLECTION}`,
  concept.kind === ANSWER_KIND ? `Question: ${concept.title}` : concept.title,
  `_${concept.trustWords}_`,
  "",
  concept.body.trimEnd(),
  ...listed("Evidence:", evidenceLines(concept.evidence)),
  "",
  `${concept.iri} — ${concept.url}`,
];

const unmappedText = (passage: PassageView): readonly string[] => [
  "",
  `${NOT_COMPANY_KNOWLEDGE} · ${passage.sensitivity}`,
  ...quoted(passage.text),
  `— ${passage.source} (${passage.locator})`,
];

export const renderAnswer = (answer: PlannedAnswer<string>): string =>
  [
    VERDICT_LINES[answer.verdict],
    `_${JUDGE_WORDS[answer.judgeState]} · ${mapWords(answer.map)}_`,
    `Collections considered: ${namedOrNone(answer.collections)}`,
    `Collections you may name: ${namedOrNone(answer.readableCollections)}`,
    ...answer.related.flatMap(returnedText),
    ...answer.unmappedPassages.flatMap(unmappedText),
  ].join("\n");

const REASON_WORDS = {
  wrong: "wrong",
  "out-of-date": "out of date",
  incomplete: "incomplete",
  "should-not-have-shown": "should not have been shown",
} satisfies Record<FeedbackReason, string>;

export const renderFeedback = (receipt: FeedbackReceipt): string => {
  const { feedback } = receipt;
  const what =
    feedback.verdict === "helpful"
      ? `helpful`
      : `flagged as ${REASON_WORDS[feedback.reason]}${feedback.detail === undefined ? "" : ` — "${feedback.detail}"`}`;
  return `Received: ${feedback.iri} marked ${what}. It reaches the owner when the Suggestions page ships.`;
};
