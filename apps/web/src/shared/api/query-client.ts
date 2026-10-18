import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ceilingLiftsIn, refusalOf, type ApiError } from "./trpc.ts";

const RETRY_ATTEMPTS = 2;

const worthAnotherAsk = (error: Error) => refusalOf(error) === undefined;

const retryUnlessWaiting = (failureCount: number, error: Error | ApiError): boolean =>
  ceilingLiftsIn(error) === undefined &&
  refusalOf(error) === undefined &&
  failureCount < RETRY_ATTEMPTS;

type Held = {
  readonly state: { readonly error: Error | ApiError | null; readonly errorUpdatedAt: number };
};

const waitedOut = ({ state }: Held): boolean => {
  const liftsInSeconds = state.error === null ? undefined : ceilingLiftsIn(state.error);
  return liftsInSeconds === undefined || state.errorUpdatedAt + liftsInSeconds * 1000 <= Date.now();
};

export const WHILE_A_CEILING_HOLDS = {
  retry: retryUnlessWaiting,
  retryOnMount: waitedOut,
  refetchOnMount: waitedOut,
  refetchOnWindowFocus: waitedOut,
  refetchOnReconnect: waitedOut,
} as const;

export type FailedDuring = "read" | "action";

export type RefusedAct = { readonly retry: () => void };

export type FailureHeard = (failure: Error, during: FailedDuring, refusedAct?: RefusedAct) => void;

export const createQueryClient = (heard: FailureHeard = () => undefined) =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: (failure) => {
        heard(failure, "read");
      },
    }),
    mutationCache: new MutationCache({
      onError: (failure, variables, _context, mutation) => {
        // As the observer's own `mutate` does: the act's answer reaches it, not this call.
        heard(failure, "action", {
          retry: () => void mutation.execute(variables).catch(() => undefined),
        });
      },
    }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => worthAnotherAsk(error) && failureCount < RETRY_ATTEMPTS,
      },
    },
  });
