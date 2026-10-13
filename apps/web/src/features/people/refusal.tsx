import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusalsOf, refusedWith } from "@/shared/refusal-outcome.tsx";
import { stockWait } from "@/shared/refusal-words.ts";

import {
  SAID_OF_A_GROUP,
  SAID_OF_A_MEMBER,
  SAID_OF_A_REQUEST,
  SAID_OF_AN_INVITATION,
} from "./refusal-words.ts";

export const { outcomeOfFailure } = refusalsOf(SAID_OF_A_MEMBER);

export const { outcomeOfFailure: outcomeOfInvitationFailure } = refusalsOf(SAID_OF_AN_INVITATION);

export const { outcomeOfFailure: outcomeOfGroupFailure } = refusalsOf(SAID_OF_A_GROUP);

export const { outcomeOfFailure: outcomeOfRequestFailure } = refusalsOf(SAID_OF_A_REQUEST);

/** The audit log has no sentence of its own, so each refusal shows its class's. */
export const { outcomeOfFailure: outcomeOfAuditLogFailure } = refusalsOf({});

/** An action that emails meets its ceiling with no word, so the wait is what it says. */
export const outcomeOfSendingFailure = (failure: Error | ApiError): Outcome => {
  const liftsInSeconds = ceilingLiftsIn(failure);
  return liftsInSeconds === undefined
    ? outcomeOfInvitationFailure(failure, "action")
    : refusedWith(stockWait(liftsInSeconds));
};
