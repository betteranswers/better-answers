import type { ConceptIri, MatchStrength } from "@better-answers/schema";

import type { ConceptRead, Frontmatter } from "../concepts/index.ts";
import {
  conceptPageOf,
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
import { findInput, openInput, type FindInput, type OpenInput } from "./boundary.ts";
import { cursorOf, type FindPosition, type FindRun } from "./cursor.ts";

export {
  findInput,
  findOutputWith,
  openInput,
  openOutputWith,
  passageView,
  type FindInput,
  type OpenInput,
} from "./boundary.ts";
export { findCursor, type FindPosition } from "./cursor.ts";

export {
  TRUST_RIDERS,
  TRUST_STATUSES,
  TRUST_TIERS,
  trustWords,
  type Trust,
  type TrustStatus,
} from "../concepts/index.ts";

export const NOT_COMPANY_KNOWLEDGE = "Not company knowledge";

/** `Iri` is `string` where an iri is only read as text, as a renderer reads it. */
type ConceptMatch<Iri extends string> = {
  readonly layer: "bundles";
  readonly iri: Iri;
  readonly kind: string;
  readonly title: string;
  readonly trust: Trust;
  readonly trustWords: string;
  readonly bundle: string;
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
  readonly trust: Trust;
  readonly trustWords: string;
  readonly evidence: readonly Evidence<Iri>[];
};

/**
 * `source` is the file's own label. `locator` or `iri` is what opens it, given only where the reader
 * may open it; neither is ever `""`.
 */
type Evidence<Iri extends string> = {
  readonly id?: string;
  readonly source: string;
  readonly at?: string;
  readonly locator?: string;
  readonly iri?: Iri;
};

type PassageView = {
  readonly locator: string;
  readonly source: string;
  readonly text: string;
  readonly sensitivity: string;
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

export type OpenResult<Iri extends string = ConceptIri> = Opened<Iri, ConceptView<Iri> & PaneWords>;

export type MapState =
  | { readonly state: "live" }
  | { readonly state: "as_of"; readonly at: string }
  | { readonly state: "unavailable_since"; readonly since: string };

export const ANSWER_VERDICTS = ["ok", "warn", "refuse"] as const;
type AnswerVerdict = (typeof ANSWER_VERDICTS)[number];

export type AnswerResult = {
  readonly verdict: AnswerVerdict;
  readonly text: string;
  readonly citations: readonly { readonly iri: string; readonly url: string }[];
  readonly conflicts: readonly {
    readonly subject: string;
    readonly values: readonly { readonly value: string; readonly evidence: string }[];
  }[];
  readonly coverage: { readonly asked: number; readonly answered: number };
  readonly unmappedPassages: readonly PassageView[];
  readonly map: MapState;
};

export const NOT_ANSWERED = "Not answered from the company's knowledge.";

export const FEEDBACK_REASONS = [
  "wrong",
  "out-of-date",
  "incomplete",
  "should-not-have-shown",
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const FEEDBACK_VERDICTS = ["helpful", "flag"] as const;
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

const bundleOf = (path: string): string => path.split("/")[0] ?? path;

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

const READERS = { role: "Viewer", purposes: [] } as const;

const findAction = declareAction({
  admits: READERS,
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
    bundle: bundleOf(concept.path),
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
  admits: READERS,
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
  const { locator, title, text, sensitivity } = passage.value;
  return ok({ found: true, passage: { locator, source: title, text, sensitivity } });
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

  const { iri, frontmatter, body, relations, trust, trustWords: words, pane } = concept.value;
  return ok({
    found: true,
    concept: {
      iri,
      frontmatter,
      body,
      relations,
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

const termsOf = (question: string): readonly string[] =>
  [...new Set(question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{3,}/gu) ?? [])].slice(
    0,
    ASK_TERMS_AT_MOST,
  );

const ASK_TERMS_AT_MOST = 8;
const ASK_MATCHES_PER_TERM = 5;

/**
 * Answers no question: the verdict is always `refuse`, and the citations are the concepts its
 * words find.
 */
export const ask = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly question: string },
): Promise<Result<AnswerResult, Error>> => {
  const named = new Map<string, OpenedConcept>();
  for (const term of termsOf(input.question)) {
    const search = { principal, tx, query: term };
    const found = await pageOf(
      [
        ["strong", conceptRun(search, "strong")],
        ["weak", conceptRun(search, "weak")],
      ],
      ASK_MATCHES_PER_TERM,
      undefined,
    );
    if (!found.ok) return err(found.error);
    for (const concept of found.value.matches) named.set(concept.iri, concept);
  }
  const citations = [...named.values()]
    .toSorted(
      (one, other) => one.title.localeCompare(other.title) || one.iri.localeCompare(other.iri),
    )
    .map((concept) => ({ iri: concept.iri, url: conceptPageOf(concept.iri) }));
  return ok({
    verdict: "refuse",
    text: NOT_ANSWERED,
    citations,
    conflicts: [],
    coverage: { asked: 1, answered: 0 },
    unmappedPassages: [],
    map: { state: "live" },
  });
};

/** Keeps nothing: the receipt echoes the input. */
export const giveFeedback = async (
  _principal: UserPrincipal,
  _tx: Tx,
  input: FeedbackInput,
): Promise<Result<FeedbackReceipt, never>> => ok({ outcome: "received", feedback: input });

const findLine = (match: FindMatch<string>): string =>
  match.layer === "bundles"
    ? `${match.kind} · ${match.title} · ${match.trustWords} · ${match.iri}`
    : `${match.kind} · ${match.title} · ${NOT_COMPANY_KNOWLEDGE} · ${match.sensitivity} · ${match.locator}`;

/** A client may read only the text, so the way to the next page is written out too. */
export const renderFind = (result: FindResult<string>): string => {
  if (result.matches.length === 0) return "Nothing in the company's knowledge matches that.";
  const lines = result.matches.map(findLine);
  return result.nextCursor === undefined
    ? lines.join("\n")
    : [...lines, "", `More follow: call find again with cursor ${result.nextCursor}`].join("\n");
};

export const renderOpen = (result: OpenView<string>): string => {
  if (!result.found) {
    return result.iri === undefined
      ? `No passage at ${result.locator ?? "that link"}.`
      : `No concept at ${result.iri}.`;
  }
  if (result.passage !== undefined) {
    const { passage } = result;
    return [
      `> ${passage.text}`,
      "",
      `— ${passage.source} (${passage.locator}) · ${passage.sensitivity}`,
    ].join("\n");
  }
  return result.concept === undefined ? "Nothing to show." : conceptText(result.concept);
};

const listed = (heading: string, lines: readonly string[]): readonly string[] =>
  lines.length === 0 ? [] : ["", heading, ...lines];

const conceptText = (concept: ConceptView<string>): string => {
  const title =
    typeof concept.frontmatter["title"] === "string" ? concept.frontmatter["title"] : concept.iri;
  const evidence = concept.evidence.map(({ source, at, locator, iri }) => {
    const named = at === undefined ? source : `${source}, ${at}`;
    const opens = locator ?? iri;
    return opens === undefined ? `- ${named}` : `- ${named} (${opens})`;
  });
  const related = concept.relations.map(
    ({ kind, title: named, target }) => `- ${kind} · ${named} · ${target}`,
  );
  return [
    `# ${title}`,
    "",
    concept.body.trimEnd(),
    "",
    `_${concept.trustWords}_`,
    ...listed("Evidence:", evidence),
    ...listed("Related:", related),
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

export const renderAnswer = (result: AnswerResult): string => {
  const verdict = {
    ok: "**Answered from the company's knowledge.**",
    warn: "**Answered with a warning for your role.**",
    refuse: `**${NOT_ANSWERED}**`,
  }[result.verdict];
  const citations = result.citations.map((c, i) => `[${i + 1}] ${c.iri} — ${c.url}`).join("\n");
  const unmapped = result.unmappedPassages
    .map(
      (p) =>
        `${NOT_COMPANY_KNOWLEDGE} · ${p.sensitivity}\n> ${p.text}\n— ${p.source} (${p.locator})`,
    )
    .join("\n\n");
  const lines = [verdict, `_${mapWords(result.map)}_`];
  if (result.verdict !== "refuse") lines.push("", result.text);
  if (citations !== "") lines.push("", citations);
  if (unmapped !== "") lines.push("", unmapped);
  return lines.join("\n");
};

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
