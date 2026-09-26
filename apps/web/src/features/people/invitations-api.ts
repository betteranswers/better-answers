import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

export type WaitingInvitation = inferOutput<
  ReturnType<typeof useTRPC>["members"]["invitations"]
>[number];

export type SentInvitation = inferOutput<ReturnType<typeof useTRPC>["members"]["invite"]>;

export const useInvitations = () => {
  const api = useTRPC();
  return useQuery(api.members.invitations.queryOptions());
};

/** Every settled act reads the list again, so the cache ends as the api left it. */
const useReconcile = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: api.members.invitations.queryKey() });
};

export const useInvite = () => {
  const api = useTRPC();
  const reconcile = useReconcile();
  return useMutation(api.members.invite.mutationOptions({ onSettled: () => reconcile() }));
};

export const useResendInvitation = () => {
  const api = useTRPC();
  const reconcile = useReconcile();
  return useMutation(
    api.members.resendInvitation.mutationOptions({ onSettled: () => reconcile() }),
  );
};

/** A cancel must read as done within a tenth of a second, so the row leaves before the api answers. */
export const useCancelInvitation = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const reconcile = useReconcile();
  const queryKey = api.members.invitations.queryKey();
  return useMutation(
    api.members.cancelInvitation.mutationOptions({
      onMutate: async (asked) => {
        await queryClient.cancelQueries({ queryKey });
        const before = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (held) =>
          held?.filter((invitation) => invitation.invitationId !== asked.invitationId),
        );
        return { before };
      },
      onError: (_refusal, _asked, held) => {
        queryClient.setQueryData(queryKey, held?.before);
      },
      onSettled: () => reconcile(),
    }),
  );
};
