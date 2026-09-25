import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createQueryClient } from "@/shared/api/query-client.ts";
import { createApiClient, TRPCProvider, type ApiClient } from "@/shared/api/trpc.ts";

export type AppClients = {
  readonly queryClient: QueryClient;
  readonly apiClient: ApiClient;
};

/**
 * A module-scope client is one cache shared by every render in the process, so a second
 * test render would see the first one's data.
 */
export const createAppClients = (): AppClients => ({
  queryClient: createQueryClient(),
  apiClient: createApiClient(),
});

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
