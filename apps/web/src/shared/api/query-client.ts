import { QueryClient } from "@tanstack/react-query";

import { refusalOf } from "./trpc.ts";

const RETRY_ATTEMPTS = 2;

/**
 * Every class names something its reader must do, and none of them is waiting, so a refusal of
 * any word is never asked again.
 */
const worthAnotherAsk = (error: Error) => refusalOf(error) === undefined;

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => worthAnotherAsk(error) && failureCount < RETRY_ATTEMPTS,
      },
    },
  });
