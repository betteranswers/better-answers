import { refusalOf, type ApiError, type Refusal } from "@/shared/api/trpc.ts";
import { selectFirst } from "@/shared/outcome.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { refusalSentence, STOCK } from "@/shared/refusal-words.ts";

import { SELECT_A_NAME_FIRST, SELECT_A_PERSON_FIRST } from "./people-keystrokes.ts";
import { SAID_OF_CORRECTING } from "./refusal-words.ts";

export const NO_PERSON_IN_FOCUS = selectFirst(SELECT_A_PERSON_FIRST);

export const NO_NAME_IN_FOCUS = selectFirst(SELECT_A_NAME_FIRST);

export const CONSOLE_CLOSED = "Access Denied";

export const saidOf = (refusal: Refusal): string =>
  refusalSentence({}, refusal.word, refusal.class);

export const readRefused = (failure: Error | ApiError): string => {
  const refusal = refusalOf(failure);
  return refusal === undefined ? STOCK.notLoaded : saidOf(refusal);
};

export const { outcomeOfFailure: revocationRefused } = refusalsOf({});

export const { outcomeOfFailure: correctingRefused } = refusalsOf(SAID_OF_CORRECTING);
