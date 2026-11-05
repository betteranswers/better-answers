import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusalsOf, refusedWith } from "@/shared/refusal-outcome.tsx";
import { stockWait } from "@/shared/refusal-words.ts";

import { SAID_OF_GUIDES } from "./guide-words.ts";

export type Failure = Error | ApiError;

const { outcomeOfFailure } = refusalsOf(SAID_OF_GUIDES);

export const said = (words: string): Outcome => ({ tone: "said", words });

export const failed = (failure: Failure): Outcome => {
  const lifts = ceilingLiftsIn(failure);
  return lifts === undefined ? outcomeOfFailure(failure, "action") : refusedWith(stockWait(lifts));
};
