import type { ApiError } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { failureOutcome, type SaidOfWord } from "@/shared/refusal-outcome.tsx";

const SAID_OF_WORD = {
  "role-forbids": {
    why: "Only an Admin of this workspace sees its members.",
    next: "Ask one of its Admins for what you need.",
  },
} satisfies SaidOfWord;

export const outcomeOfFailure = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_WORD, failure);
