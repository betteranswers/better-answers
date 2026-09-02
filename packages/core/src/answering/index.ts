import type { UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * Slice: **answering** — find, ask and open. Retrieval, traversal, citation, answer
 * records, question sets, feedback, corrections, answer tests, the promotion gate, usage
 * (ADRs 0016, 0017).
 *
 * T-004 lands the **contracts** the MCP surface serves and the human renderings
 * derived from them (ADR 0018: the text of every result is the human rendering, never
 * the JSON; ADR 0030: `open` returns structured content; ADR 0016: the one answer
 * contract, verdict first). The bodies are B9's: today there is no concept index to
 * read, so `find` answers no hits, `open` not found, `ask` a refuse verdict, and
 * `giveFeedback` a receipt. Every function takes the Principal first and runs on the
 * transaction that resolved it (`[SEC2]`).
 */

/** The trust tiers and states a unit carries (CONTEXT.md, *trust words the reader sees*). */
export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";
export type TrustStatus =
  | "current"
  | "changed-since-checked"
  | "out-of-date"
  | "draft"
  | "deprecated";

/** The two riders that may follow *Checked by* and never change the tier (CONTEXT.md). */
export type TrustRider = "imported" | "source-moved-on";

export type Trust = {
  readonly tier: TrustTier;
  readonly status: TrustStatus;
  /** The named person of a human review; null otherwise. */
  readonly checkedBy: string | null;
  /** ISO date of the latest check; null when unchecked. */
  readonly checkedAt: string | null;
  /** A check recorded before the platform, or one whose source moved on since; null otherwise. */
  readonly rider: TrustRider | null;
};

const RIDER_WORDS = {
  imported: " · imported",
  "source-moved-on": " · source moved on",
} satisfies Record<TrustRider, string>;

/**
 * The reader's words for a trust state — these and no others (CONTEXT.md). A status
 * other than *current* names itself; a current unit names its tier.
 */
export const trustWords = (trust: Trust): string => {
  switch (trust.status) {
    case "changed-since-checked":
      return "Changed since checked";
    case "out-of-date":
      return "Out of date";
    case "draft":
      return "Draft";
    case "deprecated":
      return "Deprecated";
    case "current":
      break;
  }
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

/** UK long form (`[UX1]`): "3 March 2026". */
const ukLongDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // A fixed zone, so the same instant reads the same on every machine (`[UX1]`).
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
};

export type FindHit = {
  readonly iri: string;
  readonly kind: string;
  readonly title: string;
  readonly trust: Trust;
  readonly bundle: string;
  readonly tags: readonly string[];
};

export type FindResult = {
  readonly query: string;
  readonly hits: readonly FindHit[];
};

/** An OKF frontmatter value: the JSON-shaped scalars and string lists a concept file carries. */
export type FrontmatterValue = string | number | boolean | null | readonly string[];

/** The structured form of a concept — what `open` returns and a view renders. */
export type ConceptView = {
  readonly iri: string;
  readonly frontmatter: Readonly<Record<string, FrontmatterValue>>;
  readonly body: string;
  readonly relations: readonly { readonly kind: string; readonly target: string }[];
  readonly trust: Trust;
  readonly evidence: readonly { readonly locator: string; readonly source: string }[];
};

/** The passage a citation rests on, fetched by its locator (ADR 0018: `open`'s second form). */
export type PassageView = {
  readonly locator: string;
  readonly source: string;
  readonly text: string;
  readonly sensitivity: string;
};

/** What `open` is asked for: a concept by IRI, or a passage by locator, never both. */
export type OpenInput =
  | { readonly iri: string; readonly locator?: undefined }
  | { readonly locator: string; readonly iri?: undefined };

/**
 * What `open` answers. The success case names a concept or a passage; the type allows
 * both keys optionally so the wire schema (one object with two optional fields) and
 * this type agree — exactly one is ever present, and `renderOpen` reads whichever is.
 */
export type OpenResult =
  | { readonly found: true; readonly concept?: ConceptView; readonly passage?: PassageView }
  | { readonly found: false; readonly iri?: string; readonly locator?: string };

/** The map's state, as the answer carries it (ADR 0016, 2026-08-29 amendment): never a count. */
export type MapState =
  | { readonly state: "live" }
  | { readonly state: "as_of"; readonly at: string }
  | { readonly state: "unavailable_since"; readonly since: string };

/**
 * The one answer contract (ADR 0016), folded: `verdict` first — ok · warn · refuse for
 * the caller's role — then text, citations, conflicts (both values with their
 * evidence), structured coverage, and the map's state. A *refuse* carries no prose:
 * its text is the one sentence for absent, unpublished and withheld alike, and the
 * unmapped passages beside it.
 */
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

/** The one sentence for absent, unpublished and withheld alike (ADR 0016). */
export const NOT_ANSWERED = "Not answered from the company's knowledge.";

export type FeedbackReason = "wrong" | "out-of-date" | "incomplete" | "should-not-have-shown";

/** A reader's verdict on one answer, never the platform's: helpful, or a flag with a reason (CONTEXT.md, *feedback*). */
export type FeedbackInput =
  | { readonly iri: string; readonly verdict: "helpful" }
  | {
      readonly iri: string;
      readonly verdict: "flag";
      readonly reason: FeedbackReason;
      readonly detail?: string;
    };

export type FeedbackReceipt = {
  readonly outcome: "received";
  readonly feedback: FeedbackInput;
};

export const find = async (
  _principal: UserPrincipal,
  _tx: Tx,
  input: { readonly query: string; readonly limit: number },
): Promise<FindResult> => ({ query: input.query, hits: [] });

export const open = async (
  _principal: UserPrincipal,
  _tx: Tx,
  input: OpenInput,
): Promise<OpenResult> =>
  input.iri === undefined
    ? { found: false, locator: input.locator ?? "" }
    : { found: false, iri: input.iri };

export const ask = async (
  _principal: UserPrincipal,
  _tx: Tx,
  _input: { readonly question: string },
): Promise<AnswerResult> => ({
  verdict: "refuse",
  text: NOT_ANSWERED,
  citations: [],
  conflicts: [],
  coverage: { asked: 1, answered: 0 },
  unmappedPassages: [],
  map: { state: "live" },
});

export const giveFeedback = async (
  _principal: UserPrincipal,
  _tx: Tx,
  input: FeedbackInput,
): Promise<FeedbackReceipt> => ({ outcome: "received", feedback: input });

/** The human rendering of a preview — one line per hit, never the JSON. */
export const renderFind = (result: FindResult): string =>
  result.hits.length === 0
    ? "Nothing in the company's knowledge matches that."
    : result.hits
        .map((hit) => `${hit.kind} · ${hit.title} · ${trustWords(hit.trust)} · ${hit.iri}`)
        .join("\n");

/** The human rendering of a concept or a passage, derived from its structured form. */
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
  const evidence = concept.evidence.map((item) => `- ${item.source} (${item.locator})`).join("\n");
  return [
    `# ${title}`,
    "",
    concept.body,
    "",
    `_${trustWords(concept.trust)}_`,
    ...(evidence === "" ? [] : ["", "Evidence:", evidence]),
  ].join("\n");
};

/** The map's fixed phrases (CONTEXT.md, *map*): the context header line, never a verdict. */
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

/** The human rendering of an answer — verdict first, then the map's context line (ADR 0016). */
export const renderAnswer = (result: AnswerResult): string => {
  const verdict = {
    ok: "**Answered from the company's knowledge.**",
    warn: "**Answered with a warning for your role.**",
    refuse: `**${NOT_ANSWERED}**`,
  }[result.verdict];
  const citations = result.citations.map((c, i) => `[${i + 1}] ${c.iri} — ${c.url}`).join("\n");
  const unmapped = result.unmappedPassages
    .map(
      (p) => `Not company knowledge · ${p.sensitivity}\n> ${p.text}\n— ${p.source} (${p.locator})`,
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
