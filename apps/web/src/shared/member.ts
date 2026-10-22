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

export const ownsHeld = (queryClient: QueryClient, api: ApiProxy) =>
  queryClient.getQueryData(memberOptions(api).queryKey)?.owns;

export const workspaceHeld = (queryClient: QueryClient, api: ApiProxy) =>
  queryClient.getQueryData(memberOptions(api).queryKey)?.workspace.id;

type Shown = { readonly id: string; readonly by: "member" | "answer" };

export type WorkspaceShown = NamedWorkspace & {
  readonly whenLeft: (left: () => void) => void;
};

const leftAsAnAnswerSaw = (was: Shown | undefined, now: Shown): boolean =>
  was !== undefined && was.id !== now.id && (was.by === "answer" || now.by === "answer");

export const workspaceShownBy = (queryClient: QueryClient, api: ApiProxy): WorkspaceShown => {
  const memberHash = hashKey(memberOptions(api).queryKey);
  const lefts: (() => void)[] = [];
  const held = workspaceHeld(queryClient, api);
  let shown: Shown | undefined = held === undefined ? undefined : { id: held, by: "member" };
  const learnt = (now: Shown) => {
    const was = shown;
    shown = now;
    if (leftAsAnAnswerSaw(was, now)) for (const left of lefts) left();
  };
  queryClient.getQueryCache().subscribe(({ type, query }) => {
    if (query.queryHash !== memberHash) return;
    if (type === "removed") shown = undefined;
    const now = workspaceHeld(queryClient, api);
    if (now !== undefined) learnt({ id: now, by: "member" });
  });
  return {
    forARead: () => workspaceHeld(queryClient, api),
    forAWrite: () => workspaceHeld(queryClient, api) ?? shown?.id,
    answeredIn: (id) => {
      if (workspaceHeld(queryClient, api) === undefined) learnt({ id, by: "answer" });
    },
    whenLeft: (left) => {
      lefts.push(left);
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
