import { useQuery, type QueryClient } from "@tanstack/react-query";

import { refusalOf, useTRPC, type ApiProxy, type RefusalWord } from "@/shared/api/trpc.ts";

import { rememberTheSession } from "./session-memory.ts";

/** The route has read this before the shell mounts, so a read on mount would be the second. */
const memberOptions = (api: ApiProxy) =>
  api.session.member.queryOptions(undefined, { refetchOnMount: false });

export const useMember = () => {
  const api = useTRPC();
  return useQuery(memberOptions(api));
};

/** Asked once, for a page that draws nothing until the read answers. */
export const useMemberAskedOnce = () => {
  const api = useTRPC();
  return useQuery({ ...memberOptions(api), retry: false });
};

export const useRole = () => {
  const api = useTRPC();
  return useQuery({ ...memberOptions(api), select: (held) => held.role }).data;
};

/** Read after the shell's own read, which left no answer when it failed. */
export const roleHeld = (queryClient: QueryClient, api: ApiProxy) =>
  queryClient.getQueryData(memberOptions(api).queryKey)?.role;

export const NEEDS_A_PICK: RefusalWord = "no-active-workspace";

export const NO_SESSION: RefusalWord = "no-session";

export const SECOND_FACTOR_PENDING: RefusalWord = "second-factor-pending";

/** Only what the reader answers by signing in again, or by confirming it's them, sends them on. */
const wordSendingThemOn = (error: Error): RefusalWord | undefined => {
  const refusal = refusalOf(error);
  if (refusal?.word === SECOND_FACTOR_PENDING) return refusal.word;
  return refusal?.class === "unauthenticated" ? refusal.word : undefined;
};

/**
 * The cache the shell itself reads, so a redirect that has an answer already costs no request.
 * Undefined lets the shell mount.
 */
export const memberRefusal = async (
  queryClient: QueryClient,
  api: ApiProxy,
): Promise<RefusalWord | undefined> => {
  try {
    // A read that failed for anything else is the shell's own query to retry and report.
    await queryClient.ensureQueryData({ ...memberOptions(api), retry: false });
    // Answered, so not pending: a session ending from here ended for some other reason.
    rememberTheSession("held");
    return undefined;
  } catch (error) {
    return error instanceof Error ? wordSendingThemOn(error) : undefined;
  }
};

/** A pick answers this question differently, so the answer held is wrong rather than stale. */
export const forgetMember = (queryClient: QueryClient, api: ApiProxy) => {
  queryClient.removeQueries({ queryKey: memberOptions(api).queryKey });
};

/**
 * In place, so the shell moves straight to the new answer. A failed or paused read keeps the left
 * workspace's answer, which is dropped.
 */
export const rereadMember = async (queryClient: QueryClient, api: ApiProxy) => {
  const filters = { queryKey: memberOptions(api).queryKey, exact: true };
  await queryClient.refetchQueries(filters);
  const read = queryClient.getQueryState(filters.queryKey);
  // Reset, not removed: the frame's mounted read never hears a removal and goes on drawing it.
  if (read?.status !== "success" || read.fetchStatus !== "idle") {
    void queryClient.resetQueries(filters);
  }
};
