import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ceilingLiftsIn, refusalOf, type ApiError } from "./trpc.ts";

const RETRY_ATTEMPTS = 2;

/**
 * Every class names something its reader must do, and none of them is waiting, so a refusal of
 * any word is never asked again.
 */
const worthAnotherAsk = (error: Error) => refusalOf(error) === undefined;

/** A ceiling lifts only with time, so a read that met one is not asked again at once. */
export const retryUnlessWaiting = (failureCount: number, error: Error | ApiError): boolean =>
  ceilingLiftsIn(error) === undefined &&
  refusalOf(error) === undefined &&
  failureCount < RETRY_ATTEMPTS;

/** A read saves nothing, so only a refused action leaves something unsaved. */
export type FailedDuring = "read" | "action";

/** Typed as the cache types it, though the auth library's failures arrive as plain objects. */
export type FailureHeard = (failure: Error, during: FailedDuring) => void;

export const createQueryClient = (heard: FailureHeard = () => undefined) =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: (failure) => {
        heard(failure, "read");
      },
    }),
    mutationCache: new MutationCache({
      onError: (failure) => {
        heard(failure, "action");
      },
    }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => worthAnotherAsk(error) && failureCount < RETRY_ATTEMPTS,
      },
    },
  });
