import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useOptimistic, type Undo } from "@/shared/api/optimistic.ts";
import { useTRPC } from "@/shared/api/trpc.ts";
import type { DoneBy } from "@/shared/words.ts";

import { useOperatorStanding } from "./operator.ts";

type Api = ReturnType<typeof useTRPC>;

type PeoplePage = inferOutput<Api["console"]["people"]["list"]>;

export type ListedPerson = PeoplePage["people"][number];

export type PersonInspected = inferOutput<Api["console"]["people"]["inspect"]>;

export type HeldSession = PersonInspected["sessions"][number];

export type HeldGrant = PersonInspected["grants"][number];

export type EndedGrant = PersonInspected["ended"][number];

/** The api answers a hundred at most; fifty keeps a page inside the list's second. */
export const PAGE_SIZE = 50;

export type Asked = { readonly search: string; readonly offset: number };

/** The page showing stays while the next is read, so a search never blanks the table. */
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

/**
 * In the api's order, newest act first. A grant the server ended leaves, since the act deletes the
 * tokens its end is read from.
 */
const endedEverywhere = (held: PersonInspected, at: string, by: DoneBy): PersonInspected => ({
  sessions: [],
  grants: [],
  ended: [
    ...held.grants
      .map(({ assistant, workspace, issuedAt }) => ({
        assistant: { id: assistant.id, name: assistant.name ?? assistant.id },
        workspace,
        issuedAt,
        endedAt: at,
        scope: "everywhere" as const,
        endedBy: by,
      }))
      .toSorted((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
    ...held.ended.filter((grant) => grant.scope !== "grant"),
  ],
});

/** The operator, named as the api will name them once it answers. */
const useTheOperator = (): DoneBy => {
  const standing = useOperatorStanding().data;
  return standing?.operator === true && standing.name.trim() !== ""
    ? { kind: "person", displayName: standing.name }
    : { kind: "former-member" };
};

const revokedIn = (page: PeoplePage, personId: string, at: string): PeoplePage => ({
  ...page,
  people: page.people.map((listed) =>
    listed.id === personId ? { ...listed, credentialsRevokedAt: at } : listed,
  ),
});

/** Every page of the list read so far, where `useOptimistic` takes one query. */
const useOnEveryPage = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const listKey = api.console.people.list.queryKey();
  return async (change: (page: PeoplePage) => PeoplePage): Promise<Undo> => {
    await queryClient.cancelQueries({ queryKey: listKey });
    const before = queryClient.getQueriesData<PeoplePage>({ queryKey: listKey });
    queryClient.setQueriesData<PeoplePage>({ queryKey: listKey }, (page) =>
      page === undefined ? page : change(page),
    );
    return {
      undo: () => {
        for (const [key, page] of before) queryClient.setQueryData(key, page);
      },
    };
  };
};

const undoEach = (undos: readonly Undo[] | undefined) => {
  for (const each of undos ?? []) each.undo();
};

/** Everything reads ended before the api answers, so the act lands within 100 ms. */
export const useEndEverySignInEverywhere = (personId: string) => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const optimistic = useOptimistic();
  const onEveryPage = useOnEveryPage();
  const operator = useTheOperator();
  const inspectedKey = api.console.people.inspect.queryKey({ personId });
  // The callbacks go to the hook itself: the React lint takes one passed through `mutationOptions` as run during render.
  return useMutation({
    ...api.console.people.endEverySignInAndToken.mutationOptions<readonly Undo[]>(),
    onMutate: () => {
      const at = new Date().toISOString();
      return Promise.all([
        optimistic(inspectedKey, (held) => endedEverywhere(held, at, operator)),
        onEveryPage((page) => revokedIn(page, personId, at)),
      ]);
    },
    onError: (_refusal, _asked, undos) => {
      undoEach(undos);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: inspectedKey }),
        queryClient.invalidateQueries({ queryKey: api.console.people.list.queryKey() }),
      ]),
  });
};

type NamesWaiting = inferOutput<Api["console"]["people"]["namesWaiting"]>;

export type NameWaiting = NamesWaiting[number];

export const useNamesWaiting = () => {
  const api = useTRPC();
  return useQuery(api.console.people.namesWaiting.queryOptions());
};

const renamedIn = (page: PeoplePage, personId: string, displayName: string): PeoplePage => ({
  ...page,
  people: page.people.map((listed) =>
    listed.id === personId ? { ...listed, displayName } : listed,
  ),
});

/** Corrected and off the names waiting before the api answers; trimmed, as the api keeps it. */
export const useCorrectDisplayName = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const optimistic = useOptimistic();
  const onEveryPage = useOnEveryPage();
  const waitingKey = api.console.people.namesWaiting.queryKey();
  return useMutation(
    api.console.people.correctDisplayName.mutationOptions({
      onMutate: ({ personId, displayName }) =>
        Promise.all([
          optimistic(waitingKey, (waiting) => waiting.filter((each) => each.personId !== personId)),
          onEveryPage((page) => renamedIn(page, personId, displayName.trim())),
        ]),
      onError: (_refusal, _asked, undos) => {
        undoEach(undos);
      },
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: waitingKey }),
          queryClient.invalidateQueries({ queryKey: api.console.people.list.queryKey() }),
        ]),
    }),
  );
};
