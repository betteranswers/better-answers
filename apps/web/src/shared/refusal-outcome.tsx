import type { FailedDuring } from "@/shared/api/query-client.ts";
import {
  refusalOf,
  type ApiError,
  type RefusalClass,
  type RefusalWord,
} from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusalSentence, STOCK, type OwnSentences } from "@/shared/refusal-words.ts";

export const refusedWith = (sentence: string): Outcome => ({ tone: "refused", words: sentence });

const refusalOutcome = (
  featureWords: OwnSentences,
  word: RefusalWord,
  refusalClass: RefusalClass,
): Outcome => refusedWith(refusalSentence(featureWords, word, refusalClass));

const UNANSWERED = {
  action: STOCK.tryAgain,
  read: STOCK.notLoaded,
} satisfies Record<FailedDuring, string>;

const failureOutcome = (
  featureWords: OwnSentences,
  failure: Error | ApiError,
  during: FailedDuring,
): Outcome => {
  const refusal = refusalOf(failure);
  return refusal === undefined
    ? refusedWith(UNANSWERED[during])
    : refusalOutcome(featureWords, refusal.word, refusal.class);
};

export const refusalsOf = (featureWords: OwnSentences) => ({
  outcomeOfFailure: (failure: Error | ApiError, during: FailedDuring): Outcome =>
    failureOutcome(featureWords, failure, during),
  refusedFor: (word: RefusalWord, refusalClass: RefusalClass): Outcome =>
    refusalOutcome(featureWords, word, refusalClass),
});

type ItemSaid = { readonly id: string; readonly said: string };

export const saidOfItems = (
  featureWords: OwnSentences,
  failure: Error | ApiError,
): readonly ItemSaid[] => {
  const refusal = refusalOf(failure);
  if (refusal?.items === undefined) return [];
  const ofTheSet = refusalSentence(featureWords, refusal.word, refusal.class);
  return Object.entries(refusal.items).map(([id, word]) => ({
    id,
    said: featureWords[word] ?? ofTheSet,
  }));
};

export function RefusedItemLines(properties: {
  readonly featureWords: OwnSentences;
  readonly failure: Error | ApiError;
  readonly nameOf: (id: string) => string;
}) {
  const lines = saidOfItems(properties.featureWords, properties.failure);
  if (lines.length === 0) return null;
  return (
    <ul>
      {lines.map(({ id, said }) => (
        <li key={id}>
          {properties.nameOf(id)}: {said}
        </li>
      ))}
    </ul>
  );
}

export const setRefusalOutcome = (refused: {
  readonly featureWords: OwnSentences;
  readonly failure: Error | ApiError;
  readonly nameOf: (id: string) => string;
  readonly lead: (count: number) => string;
}): Outcome => {
  const { featureWords, failure } = refused;
  const count = saidOfItems(featureWords, failure).length;
  if (count === 0) return failureOutcome(featureWords, failure, "action");
  return {
    tone: "refused",
    words: (
      <>
        <p>{refused.lead(count)}</p>
        <div className="mt-1">
          <RefusedItemLines featureWords={featureWords} failure={failure} nameOf={refused.nameOf} />
        </div>
      </>
    ),
  };
};
