import { refusalOf, type ApiError, type Refusal, type RefusalWord } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { failureOutcome, type SaidOfWord } from "@/shared/refusal-outcome.tsx";

export type Said = { readonly why: string; readonly next: string };

export const CONSOLE_CLOSED = "The console is the operator's alone";

/**
 * What every console act answers a person without the mark; their standing read says so without
 * asking one.
 */
export const NOT_THE_OPERATOR = "not-the-operator" satisfies RefusalWord;

export const ONLY_THE_OPERATOR: Said = {
  why: "Only the operator may open the console.",
  next: "Go back to your workspaces.",
};

const SESSION_ENDED: Said = { why: "Your session has ended.", next: "Sign in again." };

const REFUSED_ELSE: Said = {
  why: "The platform refused to read this for you.",
  next: "Go back to your workspaces.",
};

const UNANSWERED: Said = {
  why: "The platform did not answer, so nothing is listed.",
  next: "Try again in a moment.",
};

export const saidOf = (refusal: Refusal): Said => {
  if (refusal.word === NOT_THE_OPERATOR) return ONLY_THE_OPERATOR;
  return refusal.class === "unauthenticated" ? SESSION_ENDED : REFUSED_ELSE;
};

type ReadRefused = { readonly word: RefusalWord | undefined; readonly said: Said };

/** A refused read names its word; a failure with none is the network's or the platform's. */
export const readRefused = (failure: Error | ApiError): ReadRefused => {
  const refusal = refusalOf(failure);
  return refusal === undefined
    ? { word: undefined, said: UNANSWERED }
    : { word: refusal.word, said: saidOf(refusal) };
};

export const SIGN_IN_TOO_OLD = "sign-in-too-old" satisfies RefusalWord;

const SAID_OF_A_REVOCATION = {
  [SIGN_IN_TOO_OLD]: {
    why: "Your sign-in is more than an hour old, and revoking needs one from the last hour.",
    next: "Sign in again, and you come back to this person.",
  },
  [NOT_THE_OPERATOR]: {
    why: "Only the operator may revoke credentials everywhere.",
    next: ONLY_THE_OPERATOR.next,
  },
  "no-such-user": {
    why: "No person on the platform holds this id any more.",
    next: "Read the list again.",
  },
} satisfies SaidOfWord;

export const revocationRefused = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_A_REVOCATION, failure);
