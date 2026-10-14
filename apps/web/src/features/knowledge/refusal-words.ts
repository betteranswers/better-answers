import type { OwnSentences } from "@/shared/refusal-words.ts";

/**
 * An absent passage and a withheld one are one word, so the sentence may not say which. No page
 * raises the limit.
 */
export const SAID_OF_KNOWLEDGE = {
  "not-found": "This page isn't available. Please try searching again.",
  "spending-limit-met":
    "This workspace has reached its monthly AI spending limit; your Admin can ask better-answers to raise it.",
} satisfies OwnSentences;
