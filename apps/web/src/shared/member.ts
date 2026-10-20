import { hashKey, useQuery, type QueryClient } from "@tanstack/react-query";

import type { NamedWorkspace } from "@/shared/api/link.ts";
import { refusalOf, useTRPC, type ApiProxy, type RefusalWord } from "@/shared/api/trpc.ts";

export const memberOptions = (api: ApiProxy) =>
  api.session.member.queryOptions(undefined, { refetchOnMount: false });

export const useMember = () => {
  const api = useTRPC();
  return useQuery(memberOptions(api));
};

export const useMemberAskedOnce = () => {
  const api = useTRPC();
  return useQuery({ ...memberOptions(api), retry: false });
};

export const useRole = () => {
  const api = useTRPC();
  return useQuery({ ...memberOptions(api), select: (held) => held.role }).data;
};

export const roleHeld = (queryClient: QueryClient, api: ApiProxy) =>
  queryClient.getQueryData(memberOptions(api).queryKey)?.role;

export const workspaceHeld = (queryClient: QueryClient, api: ApiProxy) =>
  queryClient.getQueryData(memberOptions(api).queryKey)?.workspace.id;

const refusedOrNeverAsked = (queryClient: QueryClient, api: ApiProxy): boolean => {
  const read = queryClient.getQueryState(memberOptions(api).queryKey);
  if (read === undefined) return true;
  return read.fetchStatus === "idle" && read.error !== null && refusalOf(read.error) !== undefined;
};

/** A write names the workspace the tab last showed, so a page the session left is still refused; one that showed none waits. */
export const workspaceNamedFor = (queryClient: QueryClient, api: ApiProxy): NamedWorkspace => {
  const memberHash = hashKey(memberOptions(api).queryKey);
  let shown = workspaceHeld(queryClient, api);
  queryClient.getQueryCache().subscribe(({ type, query }) => {
    if (query.queryHash !== memberHash) return;
    shown = type === "removed" ? undefined : (workspaceHeld(queryClient, api) ?? shown);
  });
  return {
    forARead: () => workspaceHeld(queryClient, api),
    forAWrite: async () => {
      if (shown !== undefined || refusedOrNeverAsked(queryClient, api)) return shown;
      // A read that fails leaves the api to judge the write: one naming no workspace is refused.
      return queryClient.ensureQueryData(memberOptions(api)).then(
        (member) => member.workspace.id,
        () => undefined,
      );
    },
  };
};

export const leftFor = (held: string | undefined, now: string | undefined): boolean =>
  held !== undefined && now !== undefined && now !== held;

export const NEEDS_A_PICK: RefusalWord = "no-active-workspace";

export const NO_SESSION: RefusalWord = "no-session";

export const SECOND_FACTOR_PENDING: RefusalWord = "second-factor-pending";

export const WORKSPACE_SWITCHED: RefusalWord = "workspace-switched";

const wordSendingThemOn = (error: Error): RefusalWord | undefined => {
  const refusal = refusalOf(error);
  if (refusal?.word === SECOND_FACTOR_PENDING) return refusal.word;
  return refusal?.class === "unauthenticated" ? refusal.word : undefined;
};

export const memberRefusal = async (
  queryClient: QueryClient,
  api: ApiProxy,
  onRead: () => void,
): Promise<RefusalWord | undefined> => {
  try {
    await queryClient.ensureQueryData({ ...memberOptions(api), retry: false });
    onRead();
    return undefined;
  } catch (error) {
    return error instanceof Error ? wordSendingThemOn(error) : undefined;
  }
};

export const forgetMember = (queryClient: QueryClient, api: ApiProxy) => {
  queryClient.removeQueries({ queryKey: memberOptions(api).queryKey });
};

type MemberChange = {
  readonly readAgain: boolean;
  readonly ifUnread: "reset" | "keep";
};

export const memberChanged = async (
  queryClient: QueryClient,
  api: ApiProxy,
  change: MemberChange,
) => {
  const filters = { queryKey: memberOptions(api).queryKey, exact: true };
  if (change.readAgain) {
    await queryClient.refetchQueries(filters);
    // An action's settle may cancel ours with a read of its own; wait out the latest. A paused
    // read leaves the loop.
    while (queryClient.getQueryState(filters.queryKey)?.fetchStatus === "fetching") {
      await queryClient.refetchQueries(filters, { cancelRefetch: false });
    }
    const read = queryClient.getQueryState(filters.queryKey);
    if (read?.status === "success" && read.fetchStatus === "idle") return read.data;
  }
  if (change.ifUnread === "reset") void queryClient.resetQueries(filters);
  return undefined;
};
