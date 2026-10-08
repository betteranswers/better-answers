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

export const refusedWith = (said: Said): Outcome => ({
  tone: "refused",
  words: <RefusalLine said={said} />,
});

export const refusalOutcome = (
  featureWords: SaidOfWord,
  word: RefusalWord,
  refusalClass: RefusalClass,
): Outcome => refusedWith(saidOfRefusal(featureWords, word, refusalClass));

/** A read saves nothing, so its failure with no word must not say nothing was saved. */
export type FailedIn = "action" | "read";

const UNANSWERED = {
  action: NO_RESPONSE,
  read: NO_RESPONSE_TO_A_READ,
} satisfies Record<FailedIn, Said>;

/** A failure with no refusal word is the network's, never the reader's to fix. */
export const failureOutcome = (
  featureWords: SaidOfWord,
  failure: Error | ApiError,
  failedIn: FailedIn = "action",
): Outcome => {
  const refusal = refusalOf(failure);
  return refusal === undefined
    ? refusedWith(UNANSWERED[failedIn])
    : refusalOutcome(featureWords, refusal.word, refusal.class);
};

type ItemSaid = { readonly id: string; readonly said: Said };

/** An item's word crosses with no class, so a word the feature lacks is said as the whole set's. */
export const saidOfItems = (
  featureWords: SaidOfWord,
  failure: Error | ApiError,
): readonly ItemSaid[] => {
  const refusal = refusalOf(failure);
  if (refusal?.items === undefined) return [];
  const ofTheSet = saidOfRefusal(featureWords, refusal.word, refusal.class);
  return Object.entries(refusal.items).map(([id, word]) => ({
    id,
    said: featureWords[word] ?? ofTheSet,
  }));
};

export function RefusedItemLines(properties: {
  readonly featureWords: SaidOfWord;
  readonly failure: Error | ApiError;
  readonly nameOf: (id: string) => string;
}) {
  const lines = saidOfItems(properties.featureWords, properties.failure);
  if (lines.length === 0) return null;
  return (
    <ul>
      {lines.map(({ id, said }) => (
        <li key={id}>
          {properties.nameOf(id)}: <RefusalLine said={said} />
        </li>
      ))}
    </ul>
  );
}

/** A set refused whole; each item is named as the page named it at the press, shown or not. */
export const setRefusalOutcome = (refused: {
  readonly featureWords: SaidOfWord;
  readonly failure: Error | ApiError;
  readonly nameOf: (id: string) => string;
  readonly lead: (count: number) => string;
}): Outcome => {
  const { featureWords, failure } = refused;
  const count = saidOfItems(featureWords, failure).length;
  if (count === 0) return failureOutcome(featureWords, failure);
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
