import { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

const RETRY_ATTEMPTS = 2;

const isRefusal = (error: Error) =>
  error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED";

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => !isRefusal(error) && failureCount < RETRY_ATTEMPTS,
      },
    },
  });
