import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createQueryClient, type FailureHeard } from "@/shared/api/query-client.ts";
import {
  createApiClient,
  createApiProxy,
  TRPCProvider,
  type ApiClient,
  type ApiProxy,
} from "@/shared/api/trpc.ts";
import { workspaceHeld } from "@/shared/member.ts";
import { useThemeFollowed } from "@/shared/theme.ts";

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
  const queryClient = createQueryClient(failures.heard);
  // The member read's key comes from a proxy over the client this link belongs to, so the proxy is
  // made at the first send.
  let api: ApiProxy | undefined;
  const apiClient: ApiClient = createApiClient(() => {
    api ??= createApiProxy(apiClient, queryClient);
    return workspaceHeld(queryClient, api);
  });
  return { queryClient, apiClient, failures };
};

export function Providers(properties: {
  readonly clients: AppClients;
  readonly children: ReactNode;
}) {
  const { queryClient, apiClient } = properties.clients;
  useThemeFollowed();

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={apiClient} queryClient={queryClient}>
        {properties.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
