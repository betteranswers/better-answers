import type { ApiError, RefusalClass, RefusalWord } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { failureOutcome, refusalOutcome, type FailedIn } from "@/shared/refusal-outcome.tsx";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { SAID_OF_A_BINDING } from "./refusal-words.ts";

/**
 * Where the screen can tell before the click, it says what the api would refuse in the same
 * words.
 */
export const whyAndNextOf = (word: keyof typeof SAID_OF_A_BINDING): string =>
  sentenceOf(SAID_OF_A_BINDING[word]);

export const refusedFor = (word: RefusalWord, refusalClass: RefusalClass): Outcome =>
  refusalOutcome(SAID_OF_A_BINDING, word, refusalClass);

export const outcomeOfFailure = (failure: Error | ApiError, failedIn?: FailedIn): Outcome =>
  failureOutcome(SAID_OF_A_BINDING, failure, failedIn);
