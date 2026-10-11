import { useQuery, type QueryClient } from "@tanstack/react-query";

import { refusalOf, useTRPC, type ApiProxy, type RefusalWord } from "@/shared/api/trpc.ts";

/** The route has read this before the shell mounts, so a read on mount would be the second. */
export const memberOptions = (api: ApiProxy) =>
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
  onRead: () => void,
): Promise<RefusalWord | undefined> => {
  try {
    // A read that failed for anything else is the shell's own query to retry and report.
    await queryClient.ensureQueryData({ ...memberOptions(api), retry: false });
    onRead();
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
 * What a caller does about the answer held once the reader's own member has changed. Neither has
 * a default.
 */
type MemberChange = {
  /** False where no member is left to read. */
  readonly readAgain: boolean;
  /** Unread, the answer held is the one from before the change. */
  readonly ifUnread: "reset" | "keep";
};

/** In place, so the shell moves straight to the new answer. Undefined when the member is unread. */
export const memberChanged = async (
  queryClient: QueryClient,
  api: ApiProxy,
  change: MemberChange,
) => {
  const filters = { queryKey: memberOptions(api).queryKey, exact: true };
  if (change.readAgain) {
    await queryClient.refetchQueries(filters);
    const read = queryClient.getQueryState(filters.queryKey);
    // `refetchQueries` resolves on a failed or paused read too, so only a settled answer counts.
    if (read?.status === "success" && read.fetchStatus === "idle") return read.data;
  }
  // Reset, not removed: the frame's mounted read never hears a removal and goes on drawing it.
  if (change.ifUnread === "reset") void queryClient.resetQueries(filters);
  return undefined;
};
