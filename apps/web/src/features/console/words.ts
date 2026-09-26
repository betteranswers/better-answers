import { refusalOf, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { failureOutcome } from "@/shared/refusal-outcome.tsx";
import { NO_RESPONSE_TO_A_READ, SAID_OF_CLASS, type Said } from "@/shared/refusal-words.ts";

import {
  NOT_THE_OPERATOR,
  ONLY_THE_OPERATOR,
  READ_REFUSED,
  SAID_OF_A_REVOCATION,
  SAID_OF_CORRECTING,
  SIGN_IN_TOO_OLD,
} from "./refusal-words.ts";

export const CONSOLE_CLOSED = "The console is the operator's alone";

export const saidOf = (refusal: Refusal): Said => {
  if (refusal.word === NOT_THE_OPERATOR) return ONLY_THE_OPERATOR;
  return refusal.class === "unauthenticated" ? SAID_OF_CLASS.unauthenticated : READ_REFUSED;
};

/** A failure with no refusal word is the network's. */
export const readRefused = (failure: Error | ApiError): Said => {
  const refusal = refusalOf(failure);
  return refusal === undefined ? NO_RESPONSE_TO_A_READ : saidOf(refusal);
};

/** Refused for a sign-in over an hour old, which signing in again mends. */
export const refusedAsStale = (failure: Error | ApiError | null): boolean =>
  failure !== null && refusalOf(failure)?.word === SIGN_IN_TOO_OLD;

export const revocationRefused = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_A_REVOCATION, failure);

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
