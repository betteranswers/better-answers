import type { UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * Slice: **answering** — find, ask and open. Retrieval, traversal, citation, answer
 * records, question sets, feedback, corrections, answer tests, the promotion gate, usage
 * (ADRs 0016, 0017).
 *
 * T-004 lands the **contracts** the MCP surface serves and the human renderings
 * derived from them (ADR 0018: the text of every result is the human rendering, never
 * the JSON; ADR 0030: `open` returns structured content). The bodies are B9's
 * (`T-009`'s successor on the queue): today there is no concept index to read, so
 * `find` answers no hits, `open` not found, `ask` a refuse verdict, and `giveFeedback`
 * a receipt. Every function takes the Principal first and runs on the transaction
 * that resolved it (`[SEC2]`).
 */

export type TrustState = "verified" | "reviewed" | "unverified" | "stale";

export type FindHit = {
  readonly iri: string;
  readonly kind: string;
  readonly title: string;
  readonly trust: TrustState;
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
  readonly trust: { readonly state: TrustState; readonly verifiedAt: string | null };
  readonly evidence: readonly { readonly locator: string; readonly source: string }[];
};

export type OpenResult =
  | { readonly found: true; readonly concept: ConceptView }
  | { readonly found: false; readonly iri: string };

/** The answer contract (ADR 0016): verdict first. */
export type AnswerResult = {
  readonly verdict: "answered" | "warn" | "refuse";
  readonly text: string;
  readonly citations: readonly { readonly iri: string; readonly url: string }[];
};

export type FeedbackReason = "wrong" | "out-of-date" | "incomplete" | "should-not-have-shown";

export type FeedbackReceipt = {
  readonly outcome: "received";
  readonly iri: string;
  readonly reason: FeedbackReason;
};

export const find = async (
  _principal: UserPrincipal,
  _tx: Tx,
  input: { readonly query: string; readonly limit: number },
): Promise<FindResult> => ({ query: input.query, hits: [] });

export const open = async (
  _principal: UserPrincipal,
  _tx: Tx,
  input: { readonly iri: string },
): Promise<OpenResult> => ({ found: false, iri: input.iri });

export const ask = async (
  _principal: UserPrincipal,
  _tx: Tx,
  _input: { readonly question: string },
): Promise<AnswerResult> => ({
  verdict: "refuse",
  text: "Not company knowledge: nothing in the company's knowledge answers this yet.",
  citations: [],
});

export const giveFeedback = async (
  _principal: UserPrincipal,
  _tx: Tx,
  input: { readonly iri: string; readonly reason: FeedbackReason; readonly detail?: string },
): Promise<FeedbackReceipt> => ({ outcome: "received", iri: input.iri, reason: input.reason });

/** The human rendering of a preview — one line per hit, never the JSON. */
export const renderFind = (result: FindResult): string =>
  result.hits.length === 0
    ? "Nothing in the company's knowledge matches that."
    : result.hits.map((hit) => `${hit.kind} · ${hit.title} · ${hit.trust} · ${hit.iri}`).join("\n");

/** The human rendering of a concept, derived from its structured form. */
export const renderOpen = (result: OpenResult): string => {
  if (!result.found) return `No concept at ${result.iri}.`;
  const { concept } = result;
  const title = typeof concept.frontmatter["title"] === "string" ? concept.frontmatter["title"] : concept.iri;
  const evidence = concept.evidence.map((item) => `- ${item.source} (${item.locator})`).join("\n");
  return [
    `# ${title}`,
    "",
    concept.body,
    "",
    `_Trust: ${concept.trust.state}_`,
    ...(evidence === "" ? [] : ["", "Evidence:", evidence]),
  ].join("\n");
};

/** The human rendering of an answer — verdict first (ADR 0016). */
export const renderAnswer = (result: AnswerResult): string => {
  const verdict = {
    answered: "**Answered from company knowledge.**",
    warn: "**Answered with a warning.**",
    refuse: "**Not answered from company knowledge.**",
  }[result.verdict];
  const citations = result.citations.map((c, i) => `[${i + 1}] ${c.iri} — ${c.url}`).join("\n");
  return [verdict, "", result.text, ...(citations === "" ? [] : ["", citations])].join("\n");
};

export const renderFeedback = (receipt: FeedbackReceipt): string =>
  `Received: ${receipt.reason} on ${receipt.iri}. Feedback is logged today and reaches Suggestions when that screen ships.`;
