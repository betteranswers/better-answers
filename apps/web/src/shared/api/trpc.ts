import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import type { TRPCClientErrorLike } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@better-answers/api/trpc";

import { apiLink } from "./link.ts";
import { sentWithProgress } from "./upload-progress.ts";

export const TRPC_ENDPOINT = "/trpc";

// What a hook's `error` is typed as: the class's shape without the class.
export type ApiError = TRPCClientErrorLike<AppRouter>;

// The word union and its class are inferred from the router's error formatter, so the web holds
// no second copy of the api's vocabulary.
export type Refusal = NonNullable<NonNullable<ApiError["data"]>["refusal"]>;

export type RefusalWord = Refusal["word"];

export type RefusalClass = Refusal["class"];

export const refusalOf = (error: Error | ApiError): Refusal | undefined => {
  if (!(error instanceof TRPCClientError)) return undefined;
  const refusal: Refusal | undefined = error.data?.refusal;
  return refusal;
};

/** A ceiling carries no refusal word, because waiting is its one remedy. */
export const isThrottled = (error: Error | ApiError): boolean => {
  if (!(error instanceof TRPCClientError)) return false;
  const code: string | undefined = error.data?.code;
  return code === "TOO_MANY_REQUESTS";
};

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export const createApiClient = () =>
  createTRPCClient<AppRouter>({
    links: [apiLink({ url: TRPC_ENDPOINT, uploadFetch: sentWithProgress })],
  });

export type ApiClient = ReturnType<typeof createApiClient>;

// The router's redirects run outside React, where `useTRPC` cannot be called.
export const createApiProxy = (apiClient: ApiClient, queryClient: QueryClient) =>
  createTRPCOptionsProxy<AppRouter>({ client: apiClient, queryClient });

export type ApiProxy = ReturnType<typeof createApiProxy>;
