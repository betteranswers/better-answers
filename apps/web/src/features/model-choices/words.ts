import { PRODUCT_NAME } from "@/shared/words.ts";

export const MODEL_CHOICES_WORDS = {
  heading: "Model choices",
  lead: "The AI model used for each purpose.",
  whoSets: `Contact ${PRODUCT_NAME} support to set a model.`,
  noneSet: "No models set yet",
  unset: "Not set",
  provider: "Provider",
  model: "Model",
  fixed: "Fixed",
  loading: "Loading model choices…",
  failed: "The model choices didn’t load. Reload the page.",
} as const;

const PROVIDER_WORDS = new Map([
  ["anthropic", "Anthropic"],
  ["mistral", "Mistral AI"],
  ["cloudflare", "Cloudflare"],
  ["voyage", "Voyage AI"],
  ["openai", "OpenAI"],
  ["google", "Google"],
  ["local", "The platform’s own servers"],
]);

export const providerWordOf = (provider: string): string =>
  PROVIDER_WORDS.get(provider) ?? provider;
