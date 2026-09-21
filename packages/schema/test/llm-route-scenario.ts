import { EMBEDDING_DIMENSIONS } from "../src/index.ts";

export const CONFIGURED_LLM_ROUTES = [
  { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
  { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
] as const satisfies readonly {
  readonly purpose: "answering" | "embedding";
  readonly provider: string;
  readonly model: string;
}[];

export const LISTED_LLM_ROUTES = [
  {
    purpose: "extraction",
    provider: null,
    model: null,
    dimensions: null,
    fixed: false,
    retentionTail: null,
  },
  {
    purpose: "enrichment",
    provider: null,
    model: null,
    dimensions: null,
    fixed: false,
    retentionTail: null,
  },
  {
    purpose: "answering",
    provider: "anthropic",
    model: "claude-sonnet-5",
    dimensions: null,
    fixed: false,
    retentionTail: null,
  },
  {
    purpose: "judging",
    provider: null,
    model: null,
    dimensions: null,
    fixed: false,
    retentionTail: null,
  },
  {
    purpose: "embedding",
    provider: "mistral",
    model: "mistral-embed",
    dimensions: EMBEDDING_DIMENSIONS,
    fixed: true,
    retentionTail: null,
  },
] as const;
