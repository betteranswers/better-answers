import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";
import { memberOptions } from "@/shared/member/member.ts";

import { stillWaitingAfter } from "./decided.ts";

type Api = ReturnType<typeof useTRPC>;

export type WaitingItem = inferOutput<Api["inbox"]["waiting"]>["items"][number];

export type WaitingPerson = NonNullable<WaitingItem["proposer"]>;

export type WaitingEdit = inferOutput<Api["inbox"]["item"]>;

export type ConceptParts = WaitingEdit["proposed"];

export type Decided = inferOutput<Api["inbox"]["accept"]>["outcomes"][number];

export type DecidedWord = Decided["outcome"];

type Decision = inferInput<Api["inbox"]["accept"]>["decisions"][number];

export const decisionOf = (item: WaitingItem): Decision => ({
  suggestionId: item.suggestionId,
  expectedTarget: item.target,
});

export const useWaiting = () => {
  const api = useTRPC();
  return useQuery(api.inbox.waiting.queryOptions());
};

export const useWaitingEdit = (suggestionId: string) => {
  const api = useTRPC();
  return useQuery(api.inbox.item.queryOptions({ suggestionId }));
};

const useDecided = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return {
    leftTheList: (gone: ReadonlySet<string>) => {
      queryClient.setQueryData(api.inbox.waiting.queryKey(), (held) =>
        held === undefined
          ? held
          : { ...held, items: held.items.filter((item) => !gone.has(item.suggestionId)) },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: api.inbox.waiting.queryKey() });
      void queryClient.invalidateQueries({ queryKey: memberOptions(api).queryKey });
    },
  };
};

export const useAccept = () => {
  const api = useTRPC();
  const { leftTheList, onSettled } = useDecided();
  return useMutation(
    api.inbox.accept.mutationOptions({
      onSuccess: ({ outcomes }) => {
        leftTheList(
          new Set(
            outcomes
              .filter(({ outcome }) => !stillWaitingAfter(outcome))
              .map(({ suggestionId }) => suggestionId),
          ),
        );
      },
      onSettled,
    }),
  );
};

export const useDecline = () => {
  const api = useTRPC();
  const { leftTheList, onSettled } = useDecided();
  return useMutation(
    api.inbox.decline.mutationOptions({
      onSuccess: (_declined, asked) => {
        leftTheList(new Set([asked.suggestionId]));
      },
      onSettled,
    }),
  );
};
