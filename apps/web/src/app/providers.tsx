import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createQueryClient, type FailureHeard } from "@/shared/api/query-client.ts";
import { createApiClient, TRPCProvider, type ApiClient } from "@/shared/api/trpc.ts";

/** What hears a failure once a router can say where it leads: the router is made after the cache. */
type FailureListener = {
  readonly heard: FailureHeard;
  readonly answeredBy: (answer: FailureHeard) => void;
};

const aFailureListener = (): FailureListener => {
  let answer: FailureHeard = () => undefined;
  return {
    heard: (failure, during) => {
      answer(failure, during);
    },
    answeredBy: (given) => {
      answer = given;
    },
  };
};

export type AppClients = {
  readonly queryClient: QueryClient;
  readonly apiClient: ApiClient;
  readonly failures: FailureListener;
};

/**
 * A module-scope query client is one cache shared by every render in the process, so a second
 * test render would see the first one's data.
 */
export const createAppClients = (): AppClients => {
  const failures = aFailureListener();
  return {
    queryClient: createQueryClient(failures.heard),
    apiClient: createApiClient(),
    failures,
  };
};

export function Providers(properties: {
  readonly clients: AppClients;
  readonly children: ReactNode;
}) {
  const { queryClient, apiClient } = properties.clients;

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={apiClient} queryClient={queryClient}>
        {properties.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
