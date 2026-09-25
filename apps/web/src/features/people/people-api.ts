import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

import { roleOf } from "./role-meanings.ts";

type Api = ReturnType<typeof useTRPC>;

export type ListedMember = inferOutput<Api["members"]["list"]>[number];

export type Role = ListedMember["role"];

export type RoleChanged = inferOutput<Api["members"]["changeRole"]>;

export const useMembers = () => {
  const api = useTRPC();
  return useQuery(api.members.list.queryOptions());
};

/**
 * The row takes the role before the api answers, so the act lands within 100 ms. The reader's
 * own role may be the one changed.
 */
export const useChangeRole = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const listKey = api.members.list.queryKey();
  return useMutation(
    api.members.changeRole.mutationOptions({
      onMutate: async (asked) => {
        await queryClient.cancelQueries({ queryKey: listKey });
        const before = queryClient.getQueryData(listKey);
        const role = roleOf(asked.role);
        queryClient.setQueryData(listKey, (listed) =>
          listed?.map((member) =>
            member.personId === asked.personId && role !== undefined ? { ...member, role } : member,
          ),
        );
        return { before };
      },
      onError: (_refusal, _asked, taken) => {
        queryClient.setQueryData(listKey, taken?.before);
      },
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: listKey }),
          queryClient.invalidateQueries({ queryKey: api.session.membership.queryKey() }),
        ]),
    }),
  );
};
