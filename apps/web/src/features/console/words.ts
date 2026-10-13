import { refusalOf, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import { selectFirst } from "@/shared/outcome.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { refusalSentence, STOCK } from "@/shared/refusal-words.ts";

import { SELECT_A_NAME_FIRST, SELECT_A_PERSON_FIRST } from "./people-keystrokes.ts";
import { SAID_OF_A_REVOCATION, SAID_OF_CORRECTING, SIGN_IN_TOO_OLD } from "./refusal-words.ts";

export const NO_PERSON_IN_FOCUS = selectFirst(SELECT_A_PERSON_FIRST);

export const NO_NAME_IN_FOCUS = selectFirst(SELECT_A_NAME_FIRST);

export const CONSOLE_CLOSED = "Access Denied";

/** The console's reads have no sentence of their own, so each says its class's. */
export const saidOf = (refusal: Refusal): string =>
  refusalSentence({}, refusal.word, refusal.class);

/** A failure with no refusal word is the network's. */
export const readRefused = (failure: Error | ApiError): string => {
  const refusal = refusalOf(failure);
  return refusal === undefined ? STOCK.notLoaded : saidOf(refusal);
};

/** Refused for a sign-in over an hour old, which signing in again mends. */
export const refusedAsStale = (failure: Error | ApiError | null): boolean =>
  failure !== null && refusalOf(failure)?.word === SIGN_IN_TOO_OLD;

export const { outcomeOfFailure: revocationRefused } = refusalsOf(SAID_OF_A_REVOCATION);

export const { outcomeOfFailure: correctingRefused } = refusalsOf(SAID_OF_CORRECTING);
