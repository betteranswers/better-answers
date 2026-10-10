import type { ReactNode } from "react";

import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import { refusalsOf, refusedWith } from "@/shared/refusal-outcome.tsx";

import { readsCeiling, SAID_OF_KNOWLEDGE } from "./refusal-words.ts";

const { outcomeOfFailure } = refusalsOf(SAID_OF_KNOWLEDGE);

export const failedReadWords = (failure: Error | ApiError): ReactNode => {
  const liftsInSeconds = ceilingLiftsIn(failure);
  return liftsInSeconds === undefined
    ? outcomeOfFailure(failure, "read").words
    : refusedWith(readsCeiling(liftsInSeconds)).words;
};
