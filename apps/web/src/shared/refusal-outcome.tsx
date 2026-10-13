import type { FailedDuring } from "@/shared/api/query-client.ts";
import {
  refusalOf,
  type ApiError,
  type RefusalClass,
  type RefusalWord,
} from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import {
  refusalSentence,
  sentenceOf,
  STOCK,
  type OwnSentences,
  type Said,
} from "@/shared/refusal-words.ts";

/** A refusal's one sentence, or the sign-in pages' two parts joined into one. */
const sentenceShown = (said: Said | string): string =>
  typeof said === "string" ? said : sentenceOf(said);

/** The api's word stays in the logs. */
export function RefusalLine(properties: { readonly said: Said | string }) {
  return <>{sentenceShown(properties.said)}</>;
}

export const refusedWith = (said: Said | string): Outcome => ({
  tone: "refused",
  words: sentenceShown(said),
});

const refusalOutcome = (
  featureWords: OwnSentences,
  word: RefusalWord,
  refusalClass: RefusalClass,
): Outcome => refusedWith(refusalSentence(featureWords, word, refusalClass));

/** A read saves nothing, so its failure with no word says only that nothing loaded. */
const UNANSWERED = {
  action: STOCK.tryAgain,
  read: STOCK.notLoaded,
} satisfies Record<FailedDuring, string>;

/** A failure with no refusal word is the network's, never the reader's to fix. */
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

/** A feature's sentences, named once: its own for the word, then the class's, then no response. */
export const refusalsOf = (featureWords: OwnSentences) => ({
  outcomeOfFailure: (failure: Error | ApiError, during: FailedDuring): Outcome =>
    failureOutcome(featureWords, failure, during),
  refusedFor: (word: RefusalWord, refusalClass: RefusalClass): Outcome =>
    refusalOutcome(featureWords, word, refusalClass),
});

type ItemSaid = { readonly id: string; readonly said: string };

/** An item's word crosses with no class, so a word the feature lacks takes the whole set's sentence. */
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

/** A set refused whole; each item is named as the page named it at the press, shown or not. */
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
