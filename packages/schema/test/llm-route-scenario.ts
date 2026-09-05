import { EMBEDDING_DIMENSIONS } from "../src/index.ts";

/**
 * One workspace's model routes: what is seeded, and the list a reader gets back.
 *
 * Two suites drive this same scenario — the `llm` slice's own test through its export, and
 * the api's `routes.list` test over the wire — and both were writing the five rows out. They
 * are one fact: a workspace configures the routes it cares about, the list answers one row
 * per purpose whatever it configured, and the embedding route carries the dimensions the
 * index is built at and cannot be changed (`EMBEDDING_DIMENSIONS`, this package's).
 *
 * It sits beside the factory (`[TEST4]`) because that is what seeds it and what both
 * workspaces already reach for; the purpose order the list comes back in is the `llm`
 * slice's, and a suite that cares about the order asserts it there.
 */

/** The routes the scenario's workspace has chosen. Seeded through `testData().llmRoute`. */
export const CONFIGURED_LLM_ROUTES = [
  { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
  { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
] as const satisfies readonly {
  readonly purpose: "answering" | "embedding";
  readonly provider: string;
  readonly model: string;
}[];

/** What listing that workspace's routes answers: one row per purpose, in the slice's order. */
export const LISTED_LLM_ROUTES = [
  { purpose: "extraction", provider: null, model: null, dimensions: null, fixed: false },
  { purpose: "enrichment", provider: null, model: null, dimensions: null, fixed: false },
  {
    purpose: "answering",
    provider: "anthropic",
    model: "claude-sonnet-5",
    dimensions: null,
    fixed: false,
  },
  { purpose: "judging", provider: null, model: null, dimensions: null, fixed: false },
  {
    purpose: "embedding",
    provider: "mistral",
    model: "mistral-embed",
    dimensions: EMBEDDING_DIMENSIONS,
    fixed: true,
  },
] as const;
