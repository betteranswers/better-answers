import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createQueryClient } from "@/shared/api/query-client.ts";
import { createApiClient, TRPCProvider } from "@/shared/api/trpc.ts";

/**
 * Everything the screens below need before a route renders: the query cache and the tRPC
 * client that fills it. It sits above the router (`main.tsx`), so every component the router
 * renders reads the same cache. A route *loader* is not one of them — a loader runs outside
 * React, so a loader that wants this cache takes it from the router's context, which is a
 * thing to add when a screen needs it and not before.
 *
 * Both clients are made in state rather than at module scope. A module-scope client is one
 * cache shared by every render in a process, which is what makes a second test render see
 * the first one's data.
 */
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
