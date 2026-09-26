import { useQuery, type QueryClient } from "@tanstack/react-query";

import { refusalOf, useTRPC, type ApiProxy, type RefusalWord } from "@/shared/api/trpc.ts";

/** The route has read this before the shell mounts, so a read on mount would be the second. */
const membershipOptions = (api: ApiProxy) =>
  api.session.membership.queryOptions(undefined, { refetchOnMount: false });

export const useMembership = () => {
  const api = useTRPC();
  return useQuery(membershipOptions(api));
};

export const useRole = () => {
  const api = useTRPC();
  return useQuery({ ...membershipOptions(api), select: (held) => held.role }).data;
};

/** Read after the shell's own read, which left no answer when it failed. */
export const roleHeld = (queryClient: QueryClient, api: ApiProxy) =>
  queryClient.getQueryData(membershipOptions(api).queryKey)?.role;

/** Only a class the reader can answer by signing in again sends them to the sign-in screen. */
const wordSendingThemToSignIn = (error: Error): RefusalWord | undefined => {
  const refusal = refusalOf(error);
  return refusal?.class === "unauthenticated" ? refusal.word : undefined;
};

export const NEEDS_A_PICK: RefusalWord = "no-active-workspace";

/**
 * The cache the shell itself reads, so a redirect that has an answer already costs no request.
 * Undefined lets the shell mount.
 */
export const membershipRefusal = async (
  queryClient: QueryClient,
  api: ApiProxy,
): Promise<RefusalWord | undefined> => {
  try {
    // A read that failed for anything else is the shell's own query to retry and report.
    await queryClient.ensureQueryData({ ...membershipOptions(api), retry: false });
    return undefined;
  } catch (error) {
    return error instanceof Error ? wordSendingThemToSignIn(error) : undefined;
  }
};

/** A pick answers this question differently, so the answer held is wrong rather than stale. */
export const forgetMembership = (queryClient: QueryClient, api: ApiProxy) => {
  queryClient.removeQueries({ queryKey: membershipOptions(api).queryKey });
};
