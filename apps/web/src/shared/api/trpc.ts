import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import type { TRPCClientErrorLike } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@better-answers/api/trpc";

import { apiLink } from "./link.ts";
import { sentWithProgress } from "./upload-progress.ts";

export const TRPC_ENDPOINT = "/trpc";

export type ApiError = TRPCClientErrorLike<AppRouter>;

export type Refusal = NonNullable<NonNullable<ApiError["data"]>["refusal"]>;

export type RefusalWord = Refusal["word"];

export type RefusalClass = Refusal["class"];

export const refusalOf = (error: Error | ApiError): Refusal | undefined => {
  if (!(error instanceof TRPCClientError)) return undefined;
  const refusal: Refusal | undefined = error.data?.refusal;
  return refusal;
};

/**
 * The seconds until a ceiling the call met lifts. A ceiling carries no refusal word, because
 * waiting is its one remedy.
 */
export const ceilingLiftsIn = (error: Error | ApiError): number | undefined => {
  if (!(error instanceof TRPCClientError)) return undefined;
  const seconds: number | undefined = error.data?.retryAfterSeconds;
  return seconds;
};

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export const createApiClient = (heldWorkspace: () => string | undefined) =>
  createTRPCClient<AppRouter>({
    links: [apiLink({ url: TRPC_ENDPOINT, uploadFetch: sentWithProgress, heldWorkspace })],
  });

export type ApiClient = ReturnType<typeof createApiClient>;

export const createApiProxy = (apiClient: ApiClient, queryClient: QueryClient) =>
  createTRPCOptionsProxy<AppRouter>({ client: apiClient, queryClient });

export type ApiProxy = ReturnType<typeof createApiProxy>;
