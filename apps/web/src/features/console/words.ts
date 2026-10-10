import { refusalOf, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import { selectFirst } from "@/shared/outcome.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { NO_RESPONSE_TO_A_READ, SAID_OF_CLASS, type Said } from "@/shared/refusal-words.ts";

import { SELECT_A_NAME_FIRST, SELECT_A_PERSON_FIRST } from "./people-keystrokes.ts";
import {
  NOT_THE_OPERATOR,
  ONLY_THE_OPERATOR,
  READ_REFUSED,
  SAID_OF_A_REVOCATION,
  SAID_OF_CORRECTING,
  SIGN_IN_TOO_OLD,
} from "./refusal-words.ts";

export const NO_PERSON_IN_FOCUS = selectFirst(SELECT_A_PERSON_FIRST);

export const NO_NAME_IN_FOCUS = selectFirst(SELECT_A_NAME_FIRST);

export const CONSOLE_CLOSED = "The console is better-answers support’s alone";

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

export const { outcomeOfFailure: revocationRefused } = refusalsOf(SAID_OF_A_REVOCATION);

export const { outcomeOfFailure: correctingRefused } = refusalsOf(SAID_OF_CORRECTING);
