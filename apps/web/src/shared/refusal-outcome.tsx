import {
  refusalOf,
  type ApiError,
  type RefusalClass,
  type RefusalWord,
} from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import {
  NO_RESPONSE,
  NO_RESPONSE_TO_A_READ,
  saidOfRefusal,
  sentenceOf,
  type Said,
  type SaidOfWord,
} from "@/shared/refusal-words.ts";

/** What went wrong, then what the reader can do. The api's word stays in the logs. */
export function RefusalLine(properties: { readonly said: Said }) {
  return <>{sentenceOf(properties.said)}</>;
}

export const refusalOutcome = (
  featureWords: SaidOfWord,
  word: RefusalWord,
  refusalClass: RefusalClass,
): Outcome => ({
  tone: "refused",
  words: <RefusalLine said={saidOfRefusal(featureWords, word, refusalClass)} />,
});

/** A read saves nothing, so its failure with no word must not say nothing was saved. */
export type FailedIn = "act" | "read";

const UNANSWERED = {
  act: NO_RESPONSE,
  read: NO_RESPONSE_TO_A_READ,
} satisfies Record<FailedIn, Said>;

/** A failure with no refusal word is the network's, never the reader's to fix. */
export const failureOutcome = (
  featureWords: SaidOfWord,
  failure: Error | ApiError,
  failedIn: FailedIn = "act",
): Outcome => {
  const refusal = refusalOf(failure);
  return refusal === undefined
    ? { tone: "refused", words: <RefusalLine said={UNANSWERED[failedIn]} /> }
    : refusalOutcome(featureWords, refusal.word, refusal.class);
};
