import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { forgetAWorkspaceLeftElsewhere } from "@/features/auth/auth-hooks.ts";
import { createQueryClient, type FailureHeard } from "@/shared/api/query-client.ts";
import {
  createApiClient,
  createApiProxy,
  TRPCProvider,
  type ApiClient,
  type ApiProxy,
} from "@/shared/api/trpc.ts";
import { workspaceShownBy, type WorkspaceShown } from "@/shared/member.ts";
import { useThemeFollowed } from "@/shared/theme.ts";

type FailureListener = {
  readonly heard: FailureHeard;
  readonly answeredBy: (answer: FailureHeard) => void;
};

const aFailureListener = (): FailureListener => {
  let answer: FailureHeard = () => undefined;
  return {
    heard: (failure, during, refusedAct) => {
      answer(failure, during, refusedAct);
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
  readonly shown: WorkspaceShown;
};

export const createAppClients = (): AppClients => {
  const failures = aFailureListener();
  const queryClient = createQueryClient(failures.heard);
  const apiClient: ApiClient = createApiClient({
    forARead: () => shown.forARead(),
    forAWrite: () => shown.forAWrite(),
    answeredIn: (workspaceId) => {
      shown.answeredIn(workspaceId);
    },
  });
  const api: ApiProxy = createApiProxy(apiClient, queryClient);
  const shown = workspaceShownBy(queryClient, api);
  forgetAWorkspaceLeftElsewhere(queryClient, api);
  return { queryClient, apiClient, failures, shown };
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
