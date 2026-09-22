import { useQuery, type QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

import { useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";

// The route has read this before the shell mounts, so a read on mount would be the second.
const membershipOptions = (api: ApiProxy) =>
  api.session.membership.queryOptions(undefined, { refetchOnMount: false });

export const useMembership = () => {
  const api = useTRPC();
  return useQuery(membershipOptions(api));
};

const refusalOf = (error: Error): string | undefined =>
  error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED"
    ? error.message
    : undefined;

export const NEEDS_A_PICK = "no-active-workspace";

// The cache the shell itself reads, so a redirect that has an answer already costs no request.
export const membershipRefusal = async (
  queryClient: QueryClient,
  api: ApiProxy,
): Promise<string | undefined> => {
  try {
    // A read that failed for anything else is the shell's own query to retry and report.
    await queryClient.ensureQueryData({ ...membershipOptions(api), retry: false });
    return undefined;
  } catch (error) {
    return error instanceof Error ? refusalOf(error) : undefined;
  }
};

// A pick answers this question differently, so the answer held is wrong rather than stale.
export const forgetMembership = (queryClient: QueryClient, api: ApiProxy) => {
  queryClient.removeQueries({ queryKey: membershipOptions(api).queryKey });
};
