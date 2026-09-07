import type { Frontmatter, FrontmatterValue } from "../concepts/index.ts";
import { citedSource, conceptByIri, type OpenedConcept } from "../concepts/index.ts";
import { err, isPersonActor, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * Slice: **answering** — find, ask and open. Retrieval, traversal, citation, answer
 * records, question sets, feedback, corrections, answer tests, the promotion gate, usage
 * (ADRs 0016, 0017).
 *
 * T-004 lands the **contracts** the MCP surface serves and the human renderings
 * derived from them (ADR 0018: the text of every result is the human rendering, never
 * the JSON; ADR 0030: `open` returns structured content; ADR 0016: the one answer
 * contract, verdict first). The bodies are B9's, with one exception: **`open` by IRI
 * reads the concept index** (T-052), through the concepts slice's own read — a slice
 * reaches another only through its `index.ts` (ADR 0029 rule 4), and `concept_index` is
 * the concepts slice's table. `find` answers no hits, `open` by *locator* not found —
 * a passage needs the source catalogue, which is B7's — `ask` a refuse verdict, and
 * `giveFeedback` a receipt. Every function takes the Principal first and runs on the
 * transaction that resolved it.
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

/** UK long form: "3 March 2026". */
const ukLongDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // A fixed zone, so the same instant reads the same on every machine.
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

/**
 * An OKF frontmatter value, as the concepts slice defines it: the scalars, string lists and
 * `sources[]` objects a concept file carries. Re-exported rather than restated, so the view
 * and the row can never disagree about what a file may hold.
 */
export type { Frontmatter, FrontmatterSource, FrontmatterValue } from "../concepts/index.ts";

/** The structured form of a concept — what `open` returns and a view renders. */
export type ConceptView = {
  readonly iri: string;
  readonly frontmatter: Frontmatter;
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

/**
 * The four acts answer a `Result` (the kernel's result convention, `kernel/result.ts`)
 * with `never` for its error: B9's bodies read no store yet, so there is nothing that
 * can fail and no refusal word to name. The shape is the one the bodies will keep —
 * when the concept index arrives the union widens and no caller is reshaped.
 */
export const find = async (
  _principal: UserPrincipal,
  _tx: Tx,
  input: { readonly query: string; readonly limit: number },
): Promise<Result<FindResult, never>> => ok({ query: input.query, hits: [] });

/**
 * The trust a concept's row and its latest check project to (ADR 0019): a check by a person
 * earns *human-reviewed*, one by the platform or an agent *machine-confirmed*, and no check
 * at all is *Unchecked*. The status word wins over the tier when it is not *current*, and a
 * check whose hash is not the concept's own reads *Changed since checked* — which is what
 * makes the hash on the verification row load-bearing rather than decorative.
 *
 * An imported check carries no hash and so never reads *Changed since checked*; it carries
 * the *imported* rider instead, which never moves the tier.
 */
const trustOf = (concept: OpenedConcept, now: Date): Trust => {
  const { check } = concept;
  const checkedAt = check === undefined ? null : check.at.toISOString();
  const tier: TrustTier =
    check === undefined
      ? "unverified"
      : isPersonActor(check.actor)
        ? "human-reviewed"
        : "machine-confirmed";
  const rider: TrustRider | null = check?.contentHash === null ? "imported" : null;
  const moved = check?.contentHash != null && check.contentHash !== concept.contentHash;
  const status: TrustStatus =
    concept.status === "deprecated" || concept.status === "removed"
      ? "deprecated"
      : concept.status === "draft"
        ? "draft"
        : // *Out of date* comes from `stale_after` **alone** and absence means no shelf life
          // (ADR 0019) — the reader is told the fact has expired before they are told the
          // text moved, because a shelf life is a statement about the fact itself.
          pastShelfLife(concept.frontmatter["stale_after"], now)
          ? "out-of-date"
          : moved
            ? "changed-since-checked"
            : "current";
  return { tier, status, checkedBy: check?.actor ?? null, checkedAt, rider };
};

/**
 * `stale_after`'s two forms and no others (ADR 0019): a **date**, or a **datetime with an
 * offset**. The grammar is checked before anything is parsed, because `new Date` is not a
 * validator — it accepts an offsetless datetime and reads it as local time, and it accepts
 * plenty that is not a date at all. A value outside the grammar carries no shelf life, which
 * is the same answer as absence, and absence means no shelf life.
 */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Midnight UTC on a date, or nothing when the calendar has no such day. `Date.UTC` rolls an
 * impossible day forward — `2026-02-30` comes back as March — and remaps a year below 100
 * into the 1900s, so the fields are set on a date object and read back: `setUTCFullYear`
 * takes the year as written.
 */
const utcMidnight = (year: number, month: number, day: number): number | undefined => {
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  at.setUTCHours(0, 0, 0, 0);
  const same =
    at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  return same ? at.getTime() : undefined;
};

/** A day in milliseconds — the span a date-only shelf life lasts through. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a concept's shelf life has run out.
 *
 * A date alone means the concept is out of date **after that day**, not during it: `2026-03-01`
 * is a shelf life that lasts through the first of March, so the comparison is against the end
 * of that day in UTC — which is also the form the emitter writes one back in (ADR 0019). A
 * datetime names the instant itself.
 */
const pastShelfLife = (staleAfter: FrontmatterValue | undefined, now: Date): boolean => {
  if (typeof staleAfter !== "string") return false;

  const datetime = OFFSET_DATETIME.exec(staleAfter);
  if (datetime !== null) {
    // The grammar holds the shape and the calendar holds the day; only then is it parsed.
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

/**
 * What a concept's `sources[]` frontmatter entry projects to in a view (`CONTEXT.md`,
 * *evidence*). **The file's own list is the citation record until T-055**: the `evidence`
 * table is keyed by document and locator and is shared across the concepts that cite one, so
 * which concept cites which is a relation the graph derives and this read does not have.
 */
const evidenceOf = (concept: OpenedConcept): ConceptView["evidence"] => {
  const sources = concept.frontmatter["sources"];
  if (!Array.isArray(sources)) return [];
  // **The same reader the hash uses** (`citedSource`), so the view and the hash can never
  // disagree about what a file cites — a view that dropped an entry the hash still counted
  // would show a reader less evidence than the check confirmed. A `title` is shown in
  // preference to the resource where an object entry carries one, because that is what a
  // reader recognises; the legacy string form has none.
  return sources.flatMap((entry) => {
    const cited = citedSource(entry);
    if (cited === undefined) return [];
    const title = typeof entry === "string" ? undefined : entry["title"];
    return [
      {
        locator: cited.locator ?? "",
        source: typeof title === "string" && title !== "" ? title : cited.resource,
      },
    ];
  });
};

/**
 * The verbatim fetch (ADR 0018). A concept by IRI is a real read over `concept_index`
 * through the read predicate; **a concept this caller may not see answers exactly as one
 * nobody minted does** — `found: false` with the IRI echoed back — because the predicate is
 * in the statement's WHERE clause and a withheld row is not a row that came back (user
 * story 13). A locator answers not found until the source catalogue exists (B7).
 */
export const open = async (
  principal: UserPrincipal,
  tx: Tx,
  input: OpenInput,
): Promise<Result<OpenResult, Error>> => {
  if (input.iri === undefined) return ok({ found: false, locator: input.locator ?? "" });

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
      // Typed relations are derived in the graph and are never a key on the file
      // (ADR 0010), so they arrive with the graph tables (T-053).
      relations: [],
      trust: trustOf(found, new Date()),
      evidence: evidenceOf(found),
    },
  });
};

export const ask = async (
  _principal: UserPrincipal,
  _tx: Tx,
  _input: { readonly question: string },
): Promise<Result<AnswerResult, never>> =>
  ok({
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
): Promise<Result<FeedbackReceipt, never>> => ok({ outcome: "received", feedback: input });

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
