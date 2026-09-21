import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@better-answers/api/trpc";

export const TRPC_ENDPOINT = "/trpc";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export const createApiClient = () =>
  createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: TRPC_ENDPOINT })] });
