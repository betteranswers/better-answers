import { PRODUCT_NAME } from "@/shared/words.ts";

export const MODEL_CHOICES_WORDS = {
  lead: "The AI model used for each purpose in this workspace.",
  whoSets: `${PRODUCT_NAME} support sets a workspace’s models. Ask them to set one for a purpose that has none.`,
  noneSet: "No model is set for any purpose yet.",
  unset: "Not set",
  fixed: "Fixed",
  fixedReason: "This model can’t be changed.",
  loading: "The model choices are still loading.",
  failed: "The model choices did not load. Reload the page to try again.",
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
