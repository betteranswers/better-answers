import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@better-answers/api/trpc";

export const TRPC_ENDPOINT = "/trpc";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export const createApiClient = () =>
  createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: TRPC_ENDPOINT })] });

export type ApiClient = ReturnType<typeof createApiClient>;

// The router's redirects run outside React, where `useTRPC` cannot be called.
export const createApiProxy = (apiClient: ApiClient, queryClient: QueryClient) =>
  createTRPCOptionsProxy<AppRouter>({ client: apiClient, queryClient });

export type ApiProxy = ReturnType<typeof createApiProxy>;
