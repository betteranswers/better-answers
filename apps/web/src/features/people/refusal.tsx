import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { failureOutcome, refusedWith, type FailedIn } from "@/shared/refusal-outcome.tsx";

import {
  invitationsCeiling,
  SAID_OF_A_GROUP,
  SAID_OF_A_MEMBER,
  SAID_OF_A_REQUEST,
  SAID_OF_AN_INVITATION,
} from "./refusal-words.ts";

export const outcomeOfFailure = (failure: Error | ApiError, failedIn?: FailedIn): Outcome =>
  failureOutcome(SAID_OF_A_MEMBER, failure, failedIn);

export const outcomeOfInvitationFailure = (
  failure: Error | ApiError,
  failedIn?: FailedIn,
): Outcome => failureOutcome(SAID_OF_AN_INVITATION, failure, failedIn);

/** An act that emails meets its ceiling with no word, so the wait is what it says. */
export const outcomeOfSendingFailure = (failure: Error | ApiError): Outcome => {
  const liftsInSeconds = ceilingLiftsIn(failure);
  return liftsInSeconds === undefined
    ? outcomeOfInvitationFailure(failure)
    : refusedWith(invitationsCeiling(liftsInSeconds));
};

export const outcomeOfGroupFailure = (failure: Error | ApiError, failedIn?: FailedIn): Outcome =>
  failureOutcome(SAID_OF_A_GROUP, failure, failedIn);

export const outcomeOfRequestFailure = (failure: Error | ApiError, failedIn?: FailedIn): Outcome =>
  failureOutcome(SAID_OF_A_REQUEST, failure, failedIn);
