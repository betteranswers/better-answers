import type { Frontmatter, FrontmatterValue } from "../concepts/index.ts";
import { citedSource, conceptByIri, findConcepts, type OpenedConcept } from "../concepts/index.ts";
import {
  err,
  isPersonActor,
  NOT_FOUND,
  ok,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { findPassages, passageAt } from "../sources/index.ts";
import type { Tx } from "../store/postgres/index.ts";

type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";
export type TrustStatus =
  | "current"
  | "changed-since-checked"
  | "out-of-date"
  | "draft"
  | "deprecated";

type TrustRider = "imported" | "source-moved-on";

export type Trust = {
  readonly tier: TrustTier;
  readonly status: TrustStatus;

  readonly checkedBy: string | null;

  readonly checkedAt: string | null;

  readonly rider: TrustRider | null;
};

const RIDER_WORDS = {
  imported: " · imported",
  "source-moved-on": " · source moved on",
} satisfies Record<TrustRider, string>;

const STATUS_WORDS = {
  "changed-since-checked": "Changed since checked",
  "out-of-date": "Out of date",
  draft: "Draft",
  deprecated: "Deprecated",
} satisfies Record<Exclude<TrustStatus, "current">, string>;

export const trustWords = (trust: Trust): string =>
  trust.status === "current" ? checkWords(trust) : STATUS_WORDS[trust.status];

const checkWords = (trust: Trust): string => {
  const rider = trust.rider === null ? "" : RIDER_WORDS[trust.rider];
  switch (trust.tier) {
    case "human-reviewed":
      return `Checked by ${trust.checkedBy ?? "a person"}${trust.checkedAt === null ? "" : ` · ${ukLongDate(trust.checkedAt)}`}${rider}`;
    case "machine-confirmed":
      return `Checked by the platform${rider}`;
    case "unverified":
      return "Unchecked";
  }
};

const ukLongDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
};

export const NOT_COMPANY_KNOWLEDGE = "Not company knowledge";

type ConceptHit = {
  readonly layer: "bundles";
  readonly iri: string;
  readonly kind: string;
  readonly title: string;
  readonly trust: Trust;
  readonly bundle: string;
  readonly tags: readonly string[];
};

type DocumentHit = {
  readonly layer: "sources";
  readonly kind: "document";
  readonly title: string;
  readonly locator: string;
  readonly sensitivity: string;
};

export type FindHit = ConceptHit | DocumentHit;

export type FindResult = {
  readonly query: string;
  readonly hits: readonly FindHit[];
};

export type { FrontmatterValue } from "../concepts/index.ts";

type ConceptView = {
  readonly iri: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly relations: readonly { readonly kind: string; readonly target: string }[];
  readonly trust: Trust;
  readonly evidence: readonly Evidence[];
};

/** `locator` is left out when the source gives none, or gives only spaces; it is never `""`. */
type Evidence = { readonly locator?: string; readonly source: string };

type PassageView = {
  readonly locator: string;
  readonly source: string;
  readonly text: string;
  readonly sensitivity: string;
};

export type OpenInput =
  | { readonly iri: string; readonly locator?: undefined }
  | { readonly locator: string; readonly iri?: undefined };

export type OpenResult =
  | {
      readonly found: true;
      readonly concept?: ConceptView | undefined;
      readonly passage?: PassageView | undefined;
    }
  | {
      readonly found: false;
      readonly iri?: string | undefined;
      readonly locator?: string | undefined;
    };

export type MapState =
  | { readonly state: "live" }
  | { readonly state: "as_of"; readonly at: string }
  | { readonly state: "unavailable_since"; readonly since: string };

export type AnswerResult = {
  readonly verdict: "ok" | "warn" | "refuse";
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

export type FeedbackReason = "wrong" | "out-of-date" | "incomplete" | "should-not-have-shown";

export type FeedbackInput =
  | { readonly iri: string; readonly verdict: "helpful" }
  | {
      readonly iri: string;
      readonly verdict: "flag";
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

/**
 * Concepts come first, up to `limit`; passages fill the room they leave. `now` decides which
 * concepts are past their shelf life.
 */
export const find = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly query: string; readonly limit: number },
  now: Date,
): Promise<Result<FindResult, Error>> => {
  const found = await findConcepts(principal, tx, input);
  if (!found.ok) return err(found.error);
  const room = Math.max(input.limit - found.value.length, 0);
  const passages = await findPassages(principal, tx, input.query, room);
  if (!passages.ok) return err(passages.error);
  return ok({
    query: input.query,
    hits: [
      ...found.value.map((concept): ConceptHit => ({
        layer: "bundles",
        iri: concept.iri,
        kind: concept.kind,
        title: concept.title,
        trust: trustOf(concept, now),
        bundle: bundleOf(concept.path),
        tags: tagsOf(concept.frontmatter),
      })),
      ...passages.value.map((hit): DocumentHit => ({
        layer: "sources",
        kind: "document",
        title: hit.title,
        locator: hit.locator,
        sensitivity: hit.sensitivity,
      })),
    ],
  });
};

const trustOf = (concept: OpenedConcept, now: Date): Trust => {
  const { tier, checkedBy, checkedAt, rider } = trustOfCheck(concept.check);
  return { tier, status: trustStatusOf(concept, now), checkedBy, checkedAt, rider };
};

const trustOfCheck = (check: OpenedConcept["check"]): Omit<Trust, "status"> =>
  check === undefined
    ? { tier: "unverified", checkedBy: null, checkedAt: null, rider: null }
    : {
        tier: isPersonActor(check.actor) ? "human-reviewed" : "machine-confirmed",
        checkedBy: check.checkerName ?? check.actor,
        checkedAt: check.at.toISOString(),
        rider: check.contentHash === null ? "imported" : null,
      };

const trustStatusOf = (concept: OpenedConcept, now: Date): TrustStatus => {
  if (concept.status === "deprecated") return "deprecated";
  if (pastShelfLife(concept.frontmatter["stale_after"], now)) return "out-of-date";
  const checkedHash = concept.check?.contentHash;
  return checkedHash != null && checkedHash !== concept.contentHash
    ? "changed-since-checked"
    : "current";
};

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const utcMidnight = (year: number, month: number, day: number): number | undefined => {
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);

  const same =
    at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  return same ? at.getTime() : undefined;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const pastShelfLife = (staleAfter: FrontmatterValue | undefined, now: Date): boolean => {
  if (typeof staleAfter !== "string") return false;

  const datetime = OFFSET_DATETIME.exec(staleAfter);
  if (datetime !== null) {
    const day = utcMidnight(Number(datetime[1]), Number(datetime[2]), Number(datetime[3]));
    if (day === undefined) return false;
    const instant = new Date(staleAfter);
    return !Number.isNaN(instant.getTime()) && instant.getTime() < now.getTime();
  }

  const date = CALENDAR_DATE.exec(staleAfter);
  if (date === null) return false;
  const midnight = utcMidnight(Number(date[1]), Number(date[2]), Number(date[3]));

  return midnight !== undefined && midnight + ONE_DAY_MS <= now.getTime();
};

const evidenceOf = (concept: OpenedConcept): ConceptView["evidence"] => {
  const sources = concept.frontmatter["sources"];
  if (!Array.isArray(sources)) return [];

  return sources.flatMap((entry) => {
    const cited = citedSource(entry);
    if (cited === undefined) return [];

    const title = typeof entry === "string" ? undefined : entry["title"];
    const source = typeof title === "string" && title !== "" ? title : cited.resource;
    const locator = cited.locator ?? "";
    return [locator.trim() === "" ? { source } : { locator, source }];
  });
};

/** A concept or passage that is not there answers `found: false`, not an error. */
export const open = async (
  principal: UserPrincipal,
  tx: Tx,
  input: OpenInput,
  now: Date,
): Promise<Result<OpenResult, Error>> => {
  if (input.iri === undefined) {
    const passage = await passageAt(principal, tx, input.locator);
    if (!passage.ok) {
      return passage.error === NOT_FOUND
        ? ok({ found: false, locator: input.locator })
        : err(passage.error);
    }
    const { locator, title, text, sensitivity } = passage.value;
    return ok({ found: true, passage: { locator, source: title, text, sensitivity } });
  }

  const concept = await conceptByIri(principal, tx, input.iri);
  if (!concept.ok) return err(concept.error);
  if (concept.value === undefined) return ok({ found: false, iri: input.iri });

  const found = concept.value;
  return ok({
    found: true,
    concept: {
      iri: found.iri,
      frontmatter: found.frontmatter,
      body: found.body,

      relations: [],
      trust: trustOf(found, now),
      evidence: evidenceOf(found),
    },
  });
};

const termsOf = (question: string): readonly string[] =>
  [...new Set(question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{3,}/gu) ?? [])].slice(
    0,
    ASK_TERMS_AT_MOST,
  );

const ASK_TERMS_AT_MOST = 8;
const ASK_HITS_PER_TERM = 5;

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
    const found = await findConcepts(principal, tx, { query: term, limit: ASK_HITS_PER_TERM });
    if (!found.ok) return err(found.error);
    for (const concept of found.value) named.set(concept.iri, concept);
  }
  const citations = [...named.values()]
    .toSorted(
      (one, other) => one.title.localeCompare(other.title) || one.iri.localeCompare(other.iri),
    )
    .map((concept) => ({ iri: concept.iri, url: concept.iri }));
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

const findLine = (hit: FindHit): string =>
  hit.layer === "bundles"
    ? `${hit.kind} · ${hit.title} · ${trustWords(hit.trust)} · ${hit.iri}`
    : `${hit.kind} · ${hit.title} · ${NOT_COMPANY_KNOWLEDGE} · ${hit.sensitivity} · ${hit.locator}`;

export const renderFind = (result: FindResult): string =>
  result.hits.length === 0
    ? "Nothing in the company's knowledge matches that."
    : result.hits.map(findLine).join("\n");

export const renderOpen = (result: OpenResult): string => {
  if (!result.found) {
    return result.iri === undefined
      ? `No passage at ${result.locator ?? "that locator"}.`
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
  if (result.concept === undefined) return "Nothing to show.";
  const { concept } = result;
  const title =
    typeof concept.frontmatter["title"] === "string" ? concept.frontmatter["title"] : concept.iri;
  const evidence = concept.evidence
    .map(({ source, locator }) =>
      locator === undefined ? `- ${source}` : `- ${source} (${locator})`,
    )
    .join("\n");
  return [
    `# ${title}`,
    "",
    concept.body.trimEnd(),
    "",
    `_${trustWords(concept.trust)}_`,
    ...(evidence === "" ? [] : ["", "Evidence:", evidence]),
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
  return `Received: ${feedback.iri} marked ${what}. It reaches the owner's queue when the Suggestions screen ships.`;
};
