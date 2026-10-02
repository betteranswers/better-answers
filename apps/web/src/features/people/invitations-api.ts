import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC, type ApiError } from "@/shared/api/trpc.ts";

import { useActivityReadAgain } from "./people-api.ts";

type Api = ReturnType<typeof useTRPC>;

export type ListedInvitation = inferOutput<Api["members"]["invitations"]>[number];

export type InvitationStatus = NonNullable<
  Exclude<inferInput<Api["members"]["invitations"]>, void | undefined>["status"]
>;

/** One invitation and whether its email went, as every act that sends one answers it. */
export type SentInvitation = inferOutput<Api["members"]["resendInvitation"]>;

/** What inviting answers for each address: its invitation, and whether it replaced one waiting. */
export type InvitedOne = inferOutput<Api["members"]["invite"]>["invitations"][number];

export type BulkResent = inferOutput<Api["members"]["bulkResendInvitations"]>;

export type BulkCancelled = inferOutput<Api["members"]["bulkCancelInvitations"]>;

/** Its key names no workspace: a switch drops it with every read of the workspace left. */
export const useInvitations = (status: InvitationStatus) => {
  const api = useTRPC();
  return useQuery(api.members.invitations.queryOptions({ status }));
};

export const useInvitationCounts = () => {
  const api = useTRPC();
  return useQuery(api.members.invitationCounts.queryOptions());
};

type Snapshot = {
  readonly before: readonly (readonly [QueryKey, ListedInvitation[] | undefined])[];
};

/** Every settled act reads each status and the counts again; an act is a line of its Admin's Activity. */
const useReconcile = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const activityReadAgain = useActivityReadAgain();
  return () => {
    activityReadAgain();
    void queryClient.invalidateQueries(api.members.invitationCounts.pathFilter());
    return queryClient.invalidateQueries(api.members.invitations.pathFilter());
  };
};

/** The rows an act moves leave before the api answers, so it lands within 100 ms; a refusal puts them back. */
const useMoving = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const reconcile = useReconcile();

  const without = async (
    invitationIds: readonly string[],
    only: InvitationStatus | undefined,
  ): Promise<Snapshot> => {
    const filter =
      only === undefined
        ? api.members.invitations.pathFilter()
        : { queryKey: api.members.invitations.queryKey({ status: only }) };
    await queryClient.cancelQueries(filter);
    const before = queryClient.getQueriesData<ListedInvitation[]>(filter);
    const leaving = new Set(invitationIds);
    queryClient.setQueriesData<ListedInvitation[]>(filter, (rows) =>
      rows?.filter((invitation) => !leaving.has(invitation.invitationId)),
    );
    return { before };
  };

  return <Asked>(leaving: (asked: Asked) => readonly string[], only?: InvitationStatus) => ({
    onMutate: (asked: Asked) => without(leaving(asked), only),
    onError: (_refusal: ApiError, _asked: Asked, snapshot: Snapshot | undefined) => {
      for (const [queryKey, rows] of snapshot?.before ?? []) {
        queryClient.setQueryData(queryKey, rows);
      }
    },
    onSettled: () => reconcile(),
  });
};

const one = (asked: { readonly invitationId: string }) => [asked.invitationId];

const each = (asked: { readonly invitationIds: readonly string[] }) => asked.invitationIds;

export const useInvite = () => {
  const api = useTRPC();
  const reconcile = useReconcile();
  return useMutation(api.members.invite.mutationOptions({ onSettled: () => reconcile() }));
};

/** A resent expired invitation is waiting again, so it leaves the expired list at once. */
export const useResendInvitation = () => {
  const api = useTRPC();
  const moving = useMoving();
  return useMutation(api.members.resendInvitation.mutationOptions(moving(one, "expired")));
};

export const useBulkResendInvitations = () => {
  const api = useTRPC();
  const moving = useMoving();
  return useMutation(api.members.bulkResendInvitations.mutationOptions(moving(each, "expired")));
};

export const useCancelInvitation = () => {
  const api = useTRPC();
  const moving = useMoving();
  return useMutation(api.members.cancelInvitation.mutationOptions(moving(one)));
};

export const useBulkCancelInvitations = () => {
  const api = useTRPC();
  const moving = useMoving();
  return useMutation(api.members.bulkCancelInvitations.mutationOptions(moving(each)));
};
