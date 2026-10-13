import type { OwnSentences } from "@/shared/refusal-words.ts";

/** An absent passage and a withheld one are one word, so the sentence may not say which. */
export const SAID_OF_KNOWLEDGE = {
  "not-found": "This page isn't available. Please try searching again.",
} satisfies OwnSentences;
