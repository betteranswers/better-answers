import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createQueryClient } from "@/shared/api/query-client.ts";
import { createApiClient, TRPCProvider } from "@/shared/api/trpc.ts";

export function Providers(properties: { readonly children: ReactNode }) {
  // A module-scope client is one cache shared by every render in the process, so a second
  // test render would see the first one's data.
  const [queryClient] = useState(createQueryClient);
  const [apiClient] = useState(createApiClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={apiClient} queryClient={queryClient}>
        {properties.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
