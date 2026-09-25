import {
  refusalOf,
  type ApiError,
  type RefusalClass,
  type RefusalWord,
} from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";

type Said = { readonly why: string; readonly next: string };

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

export const refusedIn = (
  own: SaidOfWord,
  word: RefusalWord,
  refusalClass: RefusalClass,
): Outcome => {
  const said = own[word] ?? CLASS_WORDS[refusalClass];
  return {
    tone: "refused",
    words: (
      <>
        Refused: <code className="font-mono">{word}</code>. {said.why} {said.next}
      </>
    ),
  };
};

const UNANSWERED: Outcome = {
  tone: "refused",
  words: "The platform did not answer, so nothing changed. Try again in a moment.",
};

// A failure with no refusal word is the network's or the platform's, never the reader's to fix.
export const failureIn = (own: SaidOfWord, failure: Error | ApiError): Outcome => {
  const refusal = refusalOf(failure);
  return refusal === undefined ? UNANSWERED : refusedIn(own, refusal.word, refusal.class);
};
