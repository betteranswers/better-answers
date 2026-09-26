import { refusalOf, type ApiError, type Refusal, type RefusalWord } from "@/shared/api/trpc.ts";
import { DISPLAY_NAME_REFUSED } from "@/shared/display-name-words.ts";
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

const SIGN_IN_TOO_OLD = "sign-in-too-old" satisfies RefusalWord;

/** Refused for a sign-in over an hour old, which signing in again mends. */
export const refusedAsStale = (failure: Error | ApiError | null): boolean =>
  failure !== null && refusalOf(failure)?.word === SIGN_IN_TOO_OLD;

const NO_SUCH_PERSON: Said = {
  why: "No person on the platform holds this id any more.",
  next: "Read the list again.",
};

const SAID_OF_A_REVOCATION = {
  [SIGN_IN_TOO_OLD]: {
    why: "Your sign-in is more than an hour old, and revoking needs one from the last hour.",
    next: "Sign in again, and you come back to this person.",
  },
  [NOT_THE_OPERATOR]: {
    why: "Only the operator may revoke credentials everywhere.",
    next: ONLY_THE_OPERATOR.next,
  },
  "no-such-user": NO_SUCH_PERSON,
} satisfies SaidOfWord;

export const revocationRefused = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_A_REVOCATION, failure);

/** The rule's own words, but for a name the operator types for someone else. */
const SAID_OF_CORRECTING = {
  ...DISPLAY_NAME_REFUSED,
  "display-name-empty": {
    why: DISPLAY_NAME_REFUSED["display-name-empty"].why,
    next: "Type the name they are to be credited by.",
  },
  [SIGN_IN_TOO_OLD]: {
    why: "Your sign-in is more than an hour old, and correcting a name needs one from the last hour.",
    next: "Sign in again, and you come back here.",
  },
  [NOT_THE_OPERATOR]: {
    why: "Only the operator may correct a display name.",
    next: ONLY_THE_OPERATOR.next,
  },
  "no-such-user": NO_SUCH_PERSON,
} satisfies SaidOfWord;

export const correctingRefused = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_CORRECTING, failure);

/** A person erased since their flag has no name left to own one. */
const possessiveOf = (name: string): string => (name === "" ? "this person's" : `${name}'s`);

export const correctWords = (name: string): string => `Correct ${possessiveOf(name)} display name`;

export const correctingConsequence = (name: string): string =>
  `The name you save becomes ${possessiveOf(name)} display name in every workspace they belong to, and ends every flag waiting on it. Recorded on the identity-set audit log under your name, with no name in it.`;

/** Saving the name already held is still recorded, and still clears the flag. */
export const correctedWords = (was: string, now: string): string =>
  was === now
    ? `Saved: ${now} stands as it was, and no flag waits on it now.`
    : `Saved: ${possessiveOf(was)} display name is ${now} now, wherever the platform names them.`;
