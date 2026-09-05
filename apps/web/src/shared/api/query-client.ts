import { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

/** How many times a query is retried after a failure that might not repeat. */
const RETRY_ATTEMPTS = 2;

/**
 * A refusal is a decision, not a blip. Every refusal this api returns arrives as
 * `UNAUTHORIZED` carrying its own name — no session, no active workspace, not a member
 * (`apps/api/src/trpc/base.ts`) — and retrying one only delays the screen that has to say so
 * (ADR 0037). Everything else, including the `INTERNAL_SERVER_ERROR` raised when the session
 * store could not be reached, may well succeed on the next attempt.
 */
const isRefusal = (error: Error) =>
  error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED";

/**
 * Server state for the whole app. One per mount rather than one per module, so a second
 * render in a test never inherits the first one's cache.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => !isRefusal(error) && failureCount < RETRY_ATTEMPTS,
      },
    },
  });
