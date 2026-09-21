import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createQueryClient } from "@/shared/api/query-client.ts";
import { createApiClient, TRPCProvider } from "@/shared/api/trpc.ts";

export function Providers(properties: { readonly children: ReactNode }) {
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
