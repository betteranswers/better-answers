import { useQuery, type QueryClient } from "@tanstack/react-query";

import { refusalOf, useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";

/** The console's route reads this before its shell mounts, so a read on mount would be the second. */
const standingOptions = (api: ApiProxy) =>
  api.session.operator.queryOptions(undefined, { refetchOnMount: false });

export const useOperatorStanding = () => {
  const api = useTRPC();
  return useQuery(standingOptions(api));
};

/**
 * Only a missing session sends the reader away. `afresh` asks again, since the mark may have
 * moved since the standing was read.
 */
export const mustSignInForTheConsole = async (
  queryClient: QueryClient,
  api: ApiProxy,
  afresh: boolean,
): Promise<boolean> => {
  const asked = { ...standingOptions(api), retry: false };
  try {
    await (afresh ? queryClient.fetchQuery(asked) : queryClient.ensureQueryData(asked));
    return false;
  } catch (error) {
    return error instanceof Error && refusalOf(error)?.class === "unauthenticated";
  }
};
