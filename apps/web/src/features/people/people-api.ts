import {
  defaultScheduler,
  notifyManager,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { z } from "zod";

import { takenFrom, type Undo } from "@/shared/api/optimistic.ts";
import { useTRPC, type ApiError } from "@/shared/api/trpc.ts";
import { memberOptions, useMember } from "@/shared/member.ts";

import { roleOf } from "./role-meanings.ts";

type Api = ReturnType<typeof useTRPC>;

export type ListedMember = inferOutput<Api["members"]["list"]>[number];

export type Role = ListedMember["role"];

export type RoleChanged = inferOutput<Api["members"]["changeRole"]>;

export type ActivityEvent = inferOutput<Api["members"]["activity"]>["events"][number];

export type Direction = ActivityEvent["direction"];

/** By name, so a row the cache takes sits among the others where a reader looks for it. */
export const inNameOrder = <Named extends { readonly name: string }>(
  named: readonly Named[],
): Named[] => named.toSorted((one, other) => one.name.localeCompare(other.name));

/**
 * Newest first, a page at a time. Its key names no workspace: a switch drops it with every read of
 * the workspace left.
 */
export const useActivity = (personId: string) => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.members.activity.infiniteQueryOptions(
      { personId },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
};

/**
 * An action is a line of the member's Activity. Not awaited: a waiting first read is never cancelled,
 * so the outcome would wait too.
 */
export const useActivityReadAgain = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return (): void => {
    void queryClient.invalidateQueries(api.members.activity.pathFilter());
  };
};

export const useFlagDisplayName = () => {
  const api = useTRPC();
  const activityReadAgain = useActivityReadAgain();
  return useMutation(api.members.flagDisplayName.mutationOptions({ onSettled: activityReadAgain }));
};

export const useMembers = () => {
  const api = useTRPC();
  return useQuery(api.members.list.queryOptions());
};

const ASKED_OF = z.union([
  z.object({ personId: z.string() }).transform((asked) => [asked.personId]),
  z.object({ personIds: z.array(z.string()) }).transform((asked) => asked.personIds),
]);

/**
 * The cache tells its readers a task later by default, a frame after the press's render. Told at
 * once, the change lands in it.
 */
const toldAtOnce = (change: () => void): void => {
  notifyManager.setScheduler((notify) => {
    notify();
  });
  try {
    change();
  } finally {
    // The default goes back: notifyManager has no getter, and nothing else in the web sets a scheduler.
    notifyManager.setScheduler(defaultScheduler);
  }
};

/**
 * The list takes the action before the api answers, so it lands within 100 ms. The action may touch the
 * reader's own member row.
 */
const useReconciledList = <Asked>(
  reshape: (listed: readonly ListedMember[], asked: Asked) => readonly ListedMember[],
) => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const activityReadAgain = useActivityReadAgain();
  const readerId = useReaderId();
  const listKey = api.members.list.queryKey();
  // Callers spread these into `useMutation`: the React lint takes a callback passed through `mutationOptions` as called during render.
  return {
    onMutate: (asked: Asked): Undo => {
      void queryClient.cancelQueries({ queryKey: listKey });
      const taken = takenFrom(queryClient, listKey);
      toldAtOnce(() => {
        queryClient.setQueryData(listKey, (listed) =>
          listed === undefined ? listed : reshape(listed, asked),
        );
      });
      return taken;
    },
    onError: (_refusal: ApiError, _asked: Asked, taken: Undo | undefined) => {
      taken?.undo();
    },
    // Here, not on the page that asked: a reader gone from it before the answer still holds what they read.
    onSuccess: <Answer>(_answer: Answer, asked: Asked) => {
      if (readerId === undefined) return;
      const own = ASKED_OF.safeParse(asked).data?.includes(readerId) === true;
      if (own) void queryClient.resetQueries({ type: "inactive" });
    },
    onSettled: () => {
      activityReadAgain();
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: listKey }),
        queryClient.invalidateQueries({ queryKey: memberOptions(api).queryKey }),
      ]);
    },
  };
};

export const useChangeRole = () => {
  const api = useTRPC();
  const reconciled = useReconciledList(
    (listed, asked: { readonly personId: string; readonly role: string }) => {
      const role = roleOf(asked.role);
      return listed.map((member) =>
        member.personId === asked.personId && role !== undefined ? { ...member, role } : member,
      );
    },
  );
  return useMutation({ ...api.members.changeRole.mutationOptions<Undo>(), ...reconciled });
};

export const useEndEverySignInAndToken = () => {
  const api = useTRPC();
  const reconciled = useReconciledList((listed, asked: { readonly personId: string }) => {
    const credentialsRevokedAt = new Date().toISOString();
    return listed.map((member) =>
      member.personId === asked.personId ? { ...member, credentialsRevokedAt } : member,
    );
  });
  return useMutation({
    ...api.members.endEverySignInAndToken.mutationOptions<Undo>(),
    ...reconciled,
  });
};

const useHeldMember = () => useMember().data;

export const useReaderId = (): string | undefined => useHeldMember()?.person.id;

/** A switch keeps a removal's state, and the same person may be a member of both workspaces. */
const ASKED_IN = z.object({ workspaceId: z.string() });

export const useRemoveMember = () => {
  const api = useTRPC();
  const workspaceId = useHeldMember()?.workspace.id;
  const reconciled = useReconciledList((listed, asked: { readonly personId: string }) =>
    listed.filter((member) => member.personId !== asked.personId),
  );
  const options = { ...api.members.remove.mutationOptions<Undo>(), ...reconciled };
  const removal = useMutation(
    workspaceId === undefined ? options : { ...options, meta: { workspaceId } },
  );
  return workspaceId === undefined ? undefined : removal;
};

const ASKED_OF_ONE = z.object({ personId: z.string() });

export const useRemovalOf = (personId: string | undefined) => {
  const api = useTRPC();
  const workspaceId = useHeldMember()?.workspace.id;
  return useMutationState({
    filters: {
      mutationKey: api.members.remove.mutationKey(),
      predicate: (mutation) =>
        personId !== undefined &&
        workspaceId !== undefined &&
        ASKED_IN.safeParse(mutation.meta).data?.workspaceId === workspaceId &&
        ASKED_OF_ONE.safeParse(mutation.state.variables).data?.personId === personId,
    },
    select: (mutation) => ({ status: mutation.state.status, error: mutation.state.error }),
  }).at(-1);
};

export type BulkChanged = inferOutput<Api["members"]["bulkChangeRole"]>;

type Ticked = { readonly personIds: readonly string[] };

const tickedIn = (asked: Ticked) => {
  const ids = new Set(asked.personIds);
  return (member: ListedMember): boolean => ids.has(member.personId);
};

export const useBulkChangeRole = () => {
  const api = useTRPC();
  const reconciled = useReconciledList((listed, asked: Ticked & { readonly role: string }) => {
    const role = roleOf(asked.role);
    const ticked = tickedIn(asked);
    return listed.map((member) =>
      ticked(member) && role !== undefined ? { ...member, role } : member,
    );
  });
  return useMutation({ ...api.members.bulkChangeRole.mutationOptions<Undo>(), ...reconciled });
};

/** A group's member count moves with these actions, so the groups are read again beside the list. */
const useGroupsReadAgain = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: api.members.groups.queryKey() });
};

export const useBulkRemove = () => {
  const api = useTRPC();
  const groupsReadAgain = useGroupsReadAgain();
  const reconciled = useReconciledList((listed, asked: Ticked) => {
    const ticked = tickedIn(asked);
    return listed.filter((member) => !ticked(member));
  });
  return useMutation({
    ...api.members.bulkRemove.mutationOptions<Undo>(),
    ...reconciled,
    onSettled: () => Promise.all([reconciled.onSettled(), groupsReadAgain()]),
  });
};

type GroupHeld = ListedMember["groups"][number];

const joinedTo =
  (group: GroupHeld) =>
  (member: ListedMember): ListedMember =>
    member.groups.some((held) => held.groupId === group.groupId)
      ? member
      : { ...member, groups: inNameOrder([...member.groups, group]) };

/** The group's name is the groups read's, so the rows show it before the api answers. */
export const useBulkAddToGroup = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const groupsReadAgain = useGroupsReadAgain();
  const reconciled = useReconciledList((listed, asked: Ticked & { readonly groupId: string }) => {
    const named = queryClient
      .getQueryData(api.members.groups.queryKey())
      ?.find((group) => group.id === asked.groupId);
    if (named === undefined) return listed;
    const ticked = tickedIn(asked);
    const join = joinedTo({ groupId: named.id, name: named.name });
    return listed.map((member) => (ticked(member) ? join(member) : member));
  });
  return useMutation({
    ...api.members.bulkAddToGroup.mutationOptions<Undo>(),
    ...reconciled,
    onSettled: () => Promise.all([reconciled.onSettled(), groupsReadAgain()]),
  });
};
