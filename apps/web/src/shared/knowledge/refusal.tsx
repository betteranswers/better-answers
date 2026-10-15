import type { ReactNode } from "react";

import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { stockWait } from "@/shared/refusal-words.ts";

import { SAID_OF_KNOWLEDGE } from "./refusal-words.ts";

const { outcomeOfFailure } = refusalsOf(SAID_OF_KNOWLEDGE);

export const failedReadWords = (failure: Error | ApiError): ReactNode => {
  const liftsInSeconds = ceilingLiftsIn(failure);
  return liftsInSeconds === undefined
    ? outcomeOfFailure(failure, "read").words
    : stockWait(liftsInSeconds);
};
