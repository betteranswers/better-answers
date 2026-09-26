import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC, type ApiError } from "@/shared/api/trpc.ts";

import { roleOf } from "./role-meanings.ts";

type Api = ReturnType<typeof useTRPC>;

export type ListedMember = inferOutput<Api["members"]["list"]>[number];

export type Role = ListedMember["role"];

export type RoleChanged = inferOutput<Api["members"]["changeRole"]>;

export type CredentialsRevokedHere = inferOutput<Api["members"]["revokeCredentials"]>;

export const useFlagDisplayName = () => {
  const api = useTRPC();
  return useMutation(api.members.flagDisplayName.mutationOptions());
};

export const useMembers = () => {
  const api = useTRPC();
  return useQuery(api.members.list.queryOptions());
};

/**
 * The list takes the act before the api answers, so it lands within 100 ms. The act may touch the
 * reader's own membership.
 */
const useReconciledList = <Asked>(
  reshape: (listed: readonly ListedMember[], asked: Asked) => readonly ListedMember[],
) => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const listKey = api.members.list.queryKey();
  return {
    onMutate: async (asked: Asked) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const before = queryClient.getQueryData(listKey);
      queryClient.setQueryData(listKey, (listed) =>
        listed === undefined ? listed : reshape(listed, asked),
      );
      return { before };
    },
    onError: (
      _refusal: ApiError,
      _asked: Asked,
      taken: { readonly before: readonly ListedMember[] | undefined } | undefined,
    ) => {
      queryClient.setQueryData(listKey, taken?.before);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: listKey }),
        queryClient.invalidateQueries({ queryKey: api.session.membership.queryKey() }),
      ]),
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
  return useMutation(api.members.changeRole.mutationOptions(reconciled));
};

/** The instant shown at once is the browser's; the list read after the answer holds the api's. */
export const useRevokeCredentials = () => {
  const api = useTRPC();
  const reconciled = useReconciledList((listed, asked: { readonly personId: string }) => {
    const credentialsRevokedAt = new Date().toISOString();
    return listed.map((member) =>
      member.personId === asked.personId ? { ...member, credentialsRevokedAt } : member,
    );
  });
  return useMutation(api.members.revokeCredentials.mutationOptions(reconciled));
};

/** The shell's own read of who is signed in, shared rather than asked again. */
export const useReaderId = (): string | undefined => {
  const api = useTRPC();
  return useQuery(api.session.membership.queryOptions(undefined, { refetchOnMount: false })).data
    ?.person.id;
};

export const useRemoveMember = () => {
  const api = useTRPC();
  const reconciled = useReconciledList((listed, asked: { readonly personId: string }) =>
    listed.filter((member) => member.personId !== asked.personId),
  );
  return useMutation(api.members.remove.mutationOptions(reconciled));
};
