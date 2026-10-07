import type { Frontmatter, FrontmatterValue } from "../concepts/index.ts";
import { citedSource, conceptByIri, findConcepts, type OpenedConcept } from "../concepts/index.ts";
import {
  err,
  isActorId,
  isPersonActor,
  NOT_FOUND,
  ok,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { findPassages, passageAt } from "../sources/index.ts";
import type { Tx } from "../store/postgres/index.ts";

export const TRUST_TIERS = ["unverified", "machine-confirmed", "human-reviewed"] as const;
type TrustTier = (typeof TRUST_TIERS)[number];

export const TRUST_STATUSES = [
  "current",
  "changed-since-checked",
  "out-of-date",
  "draft",
  "deprecated",
] as const;
export type TrustStatus = (typeof TRUST_STATUSES)[number];

export const TRUST_RIDERS = ["imported", "source-moved-on"] as const;
type TrustRider = (typeof TRUST_RIDERS)[number];

export type Trust = {
  readonly tier: TrustTier;
  readonly status: TrustStatus;

  readonly verifiedBy: string | null;

  readonly verifiedAt: string | null;

  readonly rider: TrustRider | null;
};

const RIDER_WORDS = {
  imported: " · imported",
  "source-moved-on": " · source moved on",
} satisfies Record<TrustRider, string>;

const STATUS_WORDS = {
  "changed-since-checked": "Changed since verified",
  "out-of-date": "Out of date",
  draft: "Draft",
  deprecated: "Deprecated",
} satisfies Record<Exclude<TrustStatus, "current">, string>;

export const trustWords = (trust: Trust): string =>
  trust.status === "current" ? verificationWords(trust) : STATUS_WORDS[trust.status];

const verificationWords = (trust: Trust): string => {
  const rider = trust.rider === null ? "" : RIDER_WORDS[trust.rider];
  switch (trust.tier) {
    case "human-reviewed":
      return `Verified by ${verifierWords(trust.verifiedBy)}${trust.verifiedAt === null ? "" : ` · ${ukLongDate(trust.verifiedAt)}`}${rider}`;
    case "machine-confirmed":
      return `Verified automatically${rider}`;
    case "unverified":
      return "Unverified";
  }
};

/** `verifiedBy` falls back to the person's actor id once erasure has cleared their name. */
const verifierWords = (verifiedBy: string | null): string => {
  if (verifiedBy === null) return "a person";
  return isActorId(verifiedBy) && isPersonActor(verifiedBy) ? "a former member" : verifiedBy;
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

type ConceptMatch = {
  readonly layer: "bundles";
  readonly iri: string;
  readonly kind: string;
  readonly title: string;
  readonly trust: Trust;
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

export type FindMatch = ConceptMatch | DocumentMatch;

export type FindResult = {
  readonly query: string;
  readonly matches: readonly FindMatch[];
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
    matches: [
      ...found.value.map((concept): ConceptMatch => ({
        layer: "bundles",
        iri: concept.iri,
        kind: concept.kind,
        title: concept.title,
        trust: trustOf(concept, now),
        bundle: bundleOf(concept.path),
        tags: tagsOf(concept.frontmatter),
      })),
      ...passages.value.map((match): DocumentMatch => ({
        layer: "sources",
        kind: "document",
        title: match.title,
        locator: match.locator,
        sensitivity: match.sensitivity,
      })),
    ],
  });
};

const trustOf = (concept: OpenedConcept, now: Date): Trust => {
  const { tier, verifiedBy, verifiedAt, rider } = trustOfVerification(concept.verification);
  return { tier, status: trustStatusOf(concept, now), verifiedBy, verifiedAt, rider };
};

const trustOfVerification = (verification: OpenedConcept["verification"]): Omit<Trust, "status"> =>
  verification === undefined
    ? { tier: "unverified", verifiedBy: null, verifiedAt: null, rider: null }
    : {
        tier: isPersonActor(verification.actor) ? "human-reviewed" : "machine-confirmed",
        verifiedBy: verification.verifierName ?? verification.actor,
        verifiedAt: verification.at.toISOString(),
        rider: verification.contentHash === null ? "imported" : null,
      };

const trustStatusOf = (concept: OpenedConcept, now: Date): TrustStatus => {
  if (concept.status === "deprecated") return "deprecated";
  if (pastShelfLife(concept.frontmatter["stale_after"], now)) return "out-of-date";
  const verifiedHash = concept.verification?.contentHash;
  return verifiedHash != null && verifiedHash !== concept.contentHash
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
    const found = await findConcepts(principal, tx, { query: term, limit: ASK_MATCHES_PER_TERM });
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

const findLine = (match: FindMatch): string =>
  match.layer === "bundles"
    ? `${match.kind} · ${match.title} · ${trustWords(match.trust)} · ${match.iri}`
    : `${match.kind} · ${match.title} · ${NOT_COMPANY_KNOWLEDGE} · ${match.sensitivity} · ${match.locator}`;

export const renderFind = (result: FindResult): string =>
  result.matches.length === 0
    ? "Nothing in the company's knowledge matches that."
    : result.matches.map(findLine).join("\n");

export const renderOpen = (result: OpenResult): string => {
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
  return `Received: ${feedback.iri} marked ${what}. It reaches the owner's queue when the Suggestions page ships.`;
};
