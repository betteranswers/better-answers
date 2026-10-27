import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, isTRPCClientError } from "@trpc/client";
import type { TRPCClientErrorLike } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@better-answers/api/trpc";

import { apiLink, type NamedWorkspace } from "./link.ts";
import { sentWithProgress } from "./upload-progress.ts";

export const TRPC_ENDPOINT = "/trpc";

export type ApiError = TRPCClientErrorLike<AppRouter>;

export type Refusal = NonNullable<NonNullable<ApiError["data"]>["refusal"]>;

export type RefusalWord = Refusal["word"];

export type RefusalClass = Refusal["class"];

export const refusalOf = (error: Error | ApiError): Refusal | undefined => {
  if (!isTRPCClientError<AppRouter>(error)) return undefined;
  return error.data?.refusal;
};

export const ceilingLiftsIn = (error: Error | ApiError): number | undefined => {
  if (!isTRPCClientError<AppRouter>(error)) return undefined;
  return error.data?.retryAfterSeconds;
};

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export const createApiClient = (namedWorkspace: NamedWorkspace) =>
  createTRPCClient<AppRouter>({
    links: [apiLink({ url: TRPC_ENDPOINT, uploadFetch: sentWithProgress, namedWorkspace })],
  });

export type ApiClient = ReturnType<typeof createApiClient>;

export const createApiProxy = (apiClient: ApiClient, queryClient: QueryClient) =>
  createTRPCOptionsProxy<AppRouter>({ client: apiClient, queryClient });

export type ApiProxy = ReturnType<typeof createApiProxy>;
