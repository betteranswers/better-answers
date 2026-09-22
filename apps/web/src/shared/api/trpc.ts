import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { TRPCClientErrorLike } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@better-answers/api/trpc";

export const TRPC_ENDPOINT = "/trpc";

type ApiError = TRPCClientErrorLike<AppRouter>;

// The word union and its class are inferred from the router's error formatter, so the web holds
// no second copy of the api's vocabulary.
export type Refusal = NonNullable<NonNullable<ApiError["data"]>["refusal"]>;

export type RefusalWord = Refusal["word"];

export type RefusalClass = Refusal["class"];

export const refusalOf = (error: Error): Refusal | undefined => {
  if (!(error instanceof TRPCClientError)) return undefined;
  const refusal: Refusal | undefined = error.data?.refusal;
  return refusal;
};

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export const createApiClient = () =>
  createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: TRPC_ENDPOINT })] });

export type ApiClient = ReturnType<typeof createApiClient>;

// The router's redirects run outside React, where `useTRPC` cannot be called.
export const createApiProxy = (apiClient: ApiClient, queryClient: QueryClient) =>
  createTRPCOptionsProxy<AppRouter>({ client: apiClient, queryClient });

export type ApiProxy = ReturnType<typeof createApiProxy>;
