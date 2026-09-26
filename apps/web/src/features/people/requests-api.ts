import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC, type ApiError } from "@/shared/api/trpc.ts";

export type WaitingRequest = inferOutput<ReturnType<typeof useTRPC>["members"]["requests"]>[number];

/** A requester who has given no display name yet is named by their address. */
export const requesterName = (request: WaitingRequest): string =>
  request.requester.name === "" ? request.requester.email : request.requester.name;

export const useRequests = () => {
  const api = useTRPC();
  return useQuery(api.members.requests.queryOptions());
};

/** A decision reads as done within a tenth of a second: the row leaves before the api answers. */
const useLeavesAtOnce = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = api.members.requests.queryKey();
  return {
    optimistic: {
      onMutate: async (asked: { readonly requestId: string }) => {
        await queryClient.cancelQueries({ queryKey });
        const before = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (listed) =>
          listed?.filter((request) => request.id !== asked.requestId),
        );
        return { before };
      },
      onError: (
        _refusal: ApiError,
        _asked: { readonly requestId: string },
        taken: { readonly before: WaitingRequest[] | undefined } | undefined,
      ) => {
        queryClient.setQueryData(queryKey, taken?.before);
      },
    },
    reconcile: () => queryClient.invalidateQueries({ queryKey }),
  };
};

/** An approval mints an invitation, so the invitations are read again with the requests. */
export const useApproveRequest = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { optimistic, reconcile } = useLeavesAtOnce();
  return useMutation(
    api.members.approveRequest.mutationOptions({
      ...optimistic,
      onSettled: () =>
        Promise.all([
          reconcile(),
          queryClient.invalidateQueries({ queryKey: api.members.invitations.queryKey() }),
        ]),
    }),
  );
};

export const useDeclineRequest = () => {
  const api = useTRPC();
  const { optimistic, reconcile } = useLeavesAtOnce();
  return useMutation(
    api.members.declineRequest.mutationOptions({ ...optimistic, onSettled: () => reconcile() }),
  );
};
