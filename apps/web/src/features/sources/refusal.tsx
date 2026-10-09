import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { SAID_OF_A_CONNECTED_SOURCE } from "./refusal-words.ts";

/**
 * Where the page can tell before the click, it says what the api would refuse in the same
 * words.
 */
export const whyAndNextOf = (word: keyof typeof SAID_OF_A_CONNECTED_SOURCE): string =>
  sentenceOf(SAID_OF_A_CONNECTED_SOURCE[word]);

export const { outcomeOfFailure, refusedFor } = refusalsOf(SAID_OF_A_CONNECTED_SOURCE);
