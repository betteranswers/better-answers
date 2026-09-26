import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

type PeoplePage = inferOutput<Api["console"]["people"]["list"]>;

export type ListedPerson = PeoplePage["people"][number];

export type PersonInspected = inferOutput<Api["console"]["people"]["inspect"]>;

export type HeldSession = PersonInspected["sessions"][number];

export type HeldGrant = PersonInspected["grants"][number];

/** The api answers a hundred at most; fifty keeps a page inside the list's second. */
export const PAGE_SIZE = 50;

export type Asked = { readonly search: string; readonly offset: number };

/** The page on screen stays while the next is read, so a search never blanks the table. */
export const usePeople = (asked: Asked) => {
  const api = useTRPC();
  return useQuery(
    api.console.people.list.queryOptions(
      { search: asked.search, offset: asked.offset, limit: PAGE_SIZE },
      { placeholderData: keepPreviousData },
    ),
  );
};

export const useInspected = (personId: string) => {
  const api = useTRPC();
  return useQuery(api.console.people.inspect.queryOptions({ personId }));
};

const ended = (held: PersonInspected, at: string): PersonInspected => ({
  sessions: [],
  grants: held.grants.map((grant) => ({ ...grant, revokedAt: grant.revokedAt ?? at })),
});

const revokedIn = (page: PeoplePage, personId: string, at: string): PeoplePage => ({
  ...page,
  people: page.people.map((listed) =>
    listed.id === personId ? { ...listed, credentialsRevokedAt: at } : listed,
  ),
});

/** Everything reads revoked before the api answers, so the act lands within 100 ms. */
export const useRevokeEverywhere = (personId: string) => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const inspectedKey = api.console.people.inspect.queryKey({ personId });
  const listKey = api.console.people.list.queryKey();
  return useMutation(
    api.console.people.revokeCredentials.mutationOptions({
      onMutate: async () => {
        await Promise.all([
          queryClient.cancelQueries({ queryKey: inspectedKey }),
          queryClient.cancelQueries({ queryKey: listKey }),
        ]);
        const before = {
          inspected: queryClient.getQueryData(inspectedKey),
          pages: queryClient.getQueriesData<PeoplePage>({ queryKey: listKey }),
        };
        const at = new Date().toISOString();
        queryClient.setQueryData(inspectedKey, (held) =>
          held === undefined ? held : ended(held, at),
        );
        queryClient.setQueriesData<PeoplePage>({ queryKey: listKey }, (page) =>
          page === undefined ? page : revokedIn(page, personId, at),
        );
        return before;
      },
      onError: (_refusal, _asked, before) => {
        queryClient.setQueryData(inspectedKey, before?.inspected);
        for (const [key, page] of before?.pages ?? []) queryClient.setQueryData(key, page);
      },
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: inspectedKey }),
          queryClient.invalidateQueries({ queryKey: listKey }),
        ]),
    }),
  );
};
