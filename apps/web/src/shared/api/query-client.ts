import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ceilingLiftsIn, refusalOf, type ApiError } from "./trpc.ts";

const RETRY_ATTEMPTS = 2;

/**
 * Every class names something its reader must do, and none of them is waiting, so a refusal of
 * any word is never asked again.
 */
const worthAnotherAsk = (error: Error) => refusalOf(error) === undefined;

/** A ceiling lifts only with time, so a read that met one is not asked again at once. */
const retryUnlessWaiting = (failureCount: number, error: Error | ApiError): boolean =>
  ceilingLiftsIn(error) === undefined &&
  refusalOf(error) === undefined &&
  failureCount < RETRY_ATTEMPTS;

type Held = {
  readonly state: { readonly error: Error | ApiError | null; readonly errorUpdatedAt: number };
};

/** True of a read that met no ceiling, and of one whose wait has run out. */
const waitedOut = ({ state }: Held): boolean => {
  const liftsInSeconds = state.error === null ? undefined : ceilingLiftsIn(state.error);
  return liftsInSeconds === undefined || state.errorUpdatedAt + liftsInSeconds * 1000 <= Date.now();
};

/** While a ceiling's wait runs, only its reader asks again. A mount has two roads: a read holding an answer, and one holding none. */
export const WHILE_A_CEILING_HOLDS = {
  retry: retryUnlessWaiting,
  retryOnMount: waitedOut,
  refetchOnMount: waitedOut,
  refetchOnWindowFocus: waitedOut,
  refetchOnReconnect: waitedOut,
} as const;

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
