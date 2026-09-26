import type { ApiError } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { failureOutcome, type FailedIn } from "@/shared/refusal-outcome.tsx";

import {
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

export const outcomeOfGroupFailure = (failure: Error | ApiError, failedIn?: FailedIn): Outcome =>
  failureOutcome(SAID_OF_A_GROUP, failure, failedIn);

export const outcomeOfRequestFailure = (failure: Error | ApiError, failedIn?: FailedIn): Outcome =>
  failureOutcome(SAID_OF_A_REQUEST, failure, failedIn);
