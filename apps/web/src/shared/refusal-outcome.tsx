import {
  refusalOf,
  type ApiError,
  type RefusalClass,
  type RefusalWord,
} from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";

export type Said = { readonly why: string; readonly next: string };

/** A feature's own words for the refusals it knows; any other word is said by its class. */
export type SaidOfWord = Partial<Record<RefusalWord, Said>>;

const CLASS_WORDS = {
  unauthenticated: { why: "Your session has ended.", next: "Sign in again." },
  forbidden: { why: "Your role does not allow this.", next: "An Admin can take it from here." },
  absent: { why: "What this act names is not there.", next: "Read the list again." },
  malformed: { why: "The platform could not read what was sent.", next: "Send it again." },
  inapplicable: { why: "This act does not apply here.", next: "Choose another act." },
  conflict: { why: "Something changed while you were acting.", next: "Read the list again." },
  precondition: { why: "What this act waits on has not happened.", next: "Try once it has." },
} satisfies Record<RefusalClass, Said>;

/** The api's word as itself, then why and what the reader can do next. */
export function RefusalLine(properties: {
  readonly word: RefusalWord | undefined;
  readonly said: Said;
}) {
  const { word, said } = properties;

  return (
    <>
      {word === undefined ? null : (
        <>
          Refused: <code className="font-mono">{word}</code>.{" "}
        </>
      )}
      {said.why} {said.next}
    </>
  );
}

export const refusalOutcome = (
  featureWords: SaidOfWord,
  word: RefusalWord,
  refusalClass: RefusalClass,
): Outcome => ({
  tone: "refused",
  words: <RefusalLine word={word} said={featureWords[word] ?? CLASS_WORDS[refusalClass]} />,
});

const UNANSWERED: Outcome = {
  tone: "refused",
  words: "The platform did not answer, so nothing changed. Try again in a moment.",
};

// A failure with no refusal word is the network's or the platform's, never the reader's to fix.
export const failureOutcome = (featureWords: SaidOfWord, failure: Error | ApiError): Outcome => {
  const refusal = refusalOf(failure);
  return refusal === undefined
    ? UNANSWERED
    : refusalOutcome(featureWords, refusal.word, refusal.class);
};
