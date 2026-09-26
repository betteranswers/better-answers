import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import { z } from "zod";

import { useOptimistic, type Undo } from "@/shared/api/optimistic.ts";
import { useTRPC, type ApiError } from "@/shared/api/trpc.ts";

import type { ListedMember } from "./people-api.ts";

type Api = ReturnType<typeof useTRPC>;

export type ListedGroup = inferOutput<Api["members"]["groups"]>[number];

/** One member and one group: who a box puts in the group, or takes out of it. */
export type InGroup = inferInput<Api["members"]["addToGroup"]>;

type HeldGroup = ListedMember["groups"][number];

/** The one origin an Admin's own act gives a group; the wire's type holds it to the api's word. */
const CURATED: ListedGroup["origin"] = "admin-curated";

export const useGroups = () => {
  const api = useTRPC();
  return useQuery(api.members.groups.queryOptions());
};

/** By name, so a row the cache takes sits among the others where a reader looks for it. */
export const inNameOrder = <Named extends { readonly name: string }>(
  named: readonly Named[],
): Named[] => named.toSorted((one, other) => one.name.localeCompare(other.name));

const undoingEach = (undos: readonly Undo[]): Undo => ({
  undo: () => {
    for (const each of undos.toReversed()) each.undo();
  },
});

/**
 * A group's count and each member's groups say the same thing twice, so every settled act reads
 * both again.
 */
const useReconcile = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: api.members.groups.queryKey() }),
      queryClient.invalidateQueries({ queryKey: api.members.list.queryKey() }),
    ]);
};

const ASKED_NAME = z.object({ name: z.string() });

/**
 * The api mints a group's id, so a name asked for and not yet answered is drawn as a row of its
 * own until then.
 */
export const usePendingGroupNames = (): readonly (string | undefined)[] => {
  const api = useTRPC();
  return useMutationState({
    filters: { mutationKey: api.members.createGroup.mutationKey(), status: "pending" },
    select: (mutation) => ASKED_NAME.safeParse(mutation.state.variables).data?.name,
  });
};

export const useCreateGroup = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const reconcile = useReconcile();
  return useMutation(
    api.members.createGroup.mutationOptions({
      // Written before the pending name is let go, so the row never blinks out between the two.
      onSuccess: ({ groupId }, { name }) => {
        queryClient.setQueryData(api.members.groups.queryKey(), (listed) =>
          listed === undefined
            ? listed
            : inNameOrder([...listed, { id: groupId, name, origin: CURATED, memberCount: 0 }]),
        );
      },
      // Not awaited: the name stays pending until this settles, and would stand beside its row.
      onSettled: () => {
        void reconcile();
      },
    }),
  );
};

const renamedIn =
  (groupId: string, name: string) =>
  <Named extends { readonly name: string }>(named: Named, id: string): Named =>
    id === groupId ? { ...named, name } : named;

export const useRenameGroup = () => {
  const api = useTRPC();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  return useMutation(
    api.members.renameGroup.mutationOptions({
      onMutate: async (asked) => {
        const renamed = renamedIn(asked.groupId, asked.name);
        return undoingEach([
          await optimistic(api.members.groups.queryKey(), (groups) =>
            inNameOrder(groups.map((group) => renamed(group, group.id))),
          ),
          await optimistic(api.members.list.queryKey(), (members) =>
            members.map((member) => ({
              ...member,
              groups: inNameOrder(member.groups.map((group) => renamed(group, group.groupId))),
            })),
          ),
        ]);
      },
      onError: (_refusal, _asked, taken) => taken?.undo(),
      onSettled: () => reconcile(),
    }),
  );
};

export const useDeleteGroup = () => {
  const api = useTRPC();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  return useMutation(
    api.members.deleteGroup.mutationOptions({
      onMutate: async (asked) =>
        undoingEach([
          await optimistic(api.members.groups.queryKey(), (groups) =>
            groups.filter((group) => group.id !== asked.groupId),
          ),
          await optimistic(api.members.list.queryKey(), (members) =>
            members.map((member) => ({
              ...member,
              groups: member.groups.filter((group) => group.groupId !== asked.groupId),
            })),
          ),
        ]),
      onError: (_refusal, _asked, taken) => taken?.undo(),
      onSettled: () => reconcile(),
    }),
  );
};

type Way = "in" | "out";

const groupsHeld = (
  held: readonly HeldGroup[],
  joined: HeldGroup | undefined,
  asked: InGroup,
): HeldGroup[] => {
  const others = held.filter((group) => group.groupId !== asked.groupId);
  return joined === undefined ? others : inNameOrder([...others, joined]);
};

/** Putting a member in and taking them out move the same two lists, in opposite directions. */
const useGroupMoved = (way: Way) => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  const groupsKey = api.members.groups.queryKey();
  return {
    onMutate: async (asked: InGroup): Promise<Undo> => {
      const group = queryClient.getQueryData(groupsKey)?.find((each) => each.id === asked.groupId);
      const joined =
        way === "in" && group !== undefined ? { groupId: group.id, name: group.name } : undefined;
      return undoingEach([
        await optimistic(groupsKey, (groups) =>
          groups.map((each) =>
            each.id === asked.groupId
              ? { ...each, memberCount: each.memberCount + (way === "in" ? 1 : -1) }
              : each,
          ),
        ),
        await optimistic(api.members.list.queryKey(), (members) =>
          members.map((member) =>
            member.personId === asked.userId
              ? { ...member, groups: groupsHeld(member.groups, joined, asked) }
              : member,
          ),
        ),
      ]);
    },
    onError: (_refusal: ApiError, _asked: InGroup, taken: Undo | undefined) => taken?.undo(),
    onSettled: () => reconcile(),
  };
};

export const useGroupMoves = () => {
  const api = useTRPC();
  const putIn = useMutation(api.members.addToGroup.mutationOptions(useGroupMoved("in")));
  const takeOut = useMutation(api.members.removeFromGroup.mutationOptions(useGroupMoved("out")));
  return {
    putIn: (asked: InGroup) => putIn.mutateAsync(asked),
    takeOut: (asked: InGroup) => takeOut.mutateAsync(asked),
  };
};
