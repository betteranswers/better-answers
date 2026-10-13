import { PRODUCT_NAME } from "@/shared/words.ts";

export const MODEL_CHOICES_WORDS = {
  lead: "The AI model used for each purpose.",
  whoSets: `Contact ${PRODUCT_NAME} support to set a model.`,
  noneSet: "No models set yet",
  unset: "Not set",
  fixed: "Fixed",
  fixedReason: "This model can’t be changed.",
  loading: "The model choices are still loading.",
  failed: "The model choices didn’t load. Please reload the page.",
} as const;

const PROVIDER_WORDS = new Map([
  ["anthropic", "Anthropic"],
  ["mistral", "Mistral AI"],
  ["voyage", "Voyage AI"],
  ["openai", "OpenAI"],
  ["google", "Google"],
  ["local", "The platform’s own servers"],
]);

/** A provider the table has not met is shown as itself rather than dropped. */
export const providerWordOf = (provider: string): string =>
  PROVIDER_WORDS.get(provider) ?? provider;
