import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

import { ROLES } from "./role-meanings.ts";

type Api = ReturnType<typeof useTRPC>;

export type ListedMember = inferOutput<Api["members"]["list"]>[number];

export type Role = ListedMember["role"];

export type RoleChanged = inferOutput<Api["members"]["changeRole"]>;

export const useMembers = () => {
  const api = useTRPC();
  return useQuery(api.members.list.queryOptions());
};

/** The row takes the role before the api answers, so the act reads as done within 100 ms. */
export const useChangeRole = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = api.members.list.queryKey();
  return useMutation(
    api.members.changeRole.mutationOptions({
      onMutate: async (asked) => {
        await queryClient.cancelQueries({ queryKey });
        const before = queryClient.getQueryData(queryKey);
        const role = ROLES.find((held) => held === asked.role);
        queryClient.setQueryData(queryKey, (held) =>
          held?.map((member) =>
            member.personId === asked.personId && role !== undefined ? { ...member, role } : member,
          ),
        );
        return { before };
      },
      onError: (_refusal, _asked, held) => {
        queryClient.setQueryData(queryKey, held?.before);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey }),
    }),
  );
};
