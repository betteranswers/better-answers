import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";

import { useOptimistic, type Undo } from "@/shared/api/optimistic.ts";
import { WHILE_A_CEILING_HOLDS } from "@/shared/api/query-client.ts";
import { useTRPC } from "@/shared/api/trpc.ts";
import { memberOptions } from "@/shared/member.ts";

import { MATCHES_A_PAGE, type OpenKind } from "./knowledge-state.ts";

type Api = ReturnType<typeof useTRPC>;

export type Match = inferOutput<Api["knowledge"]["find"]>["matches"][number];

export type ConceptMatch = Extract<Match, { readonly layer: "bundles" }>;

export type PassageMatch = Extract<Match, { readonly layer: "sources" }>;

export const asksNothing = (query: string): boolean => query.trim() === "";

export const useMatches = (query: string) => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.knowledge.find.infiniteQueryOptions(
      asksNothing(query) ? skipToken : { query, limit: MATCHES_A_PAGE },
      { getNextPageParam: (page) => page.nextCursor, ...WHILE_A_CEILING_HOLDS },
    ),
  );
};

export type Matches = ReturnType<typeof useMatches>;

export type CollectionCounted = inferOutput<Api["knowledge"]["tree"]>["collections"][number];

export type KindConcept = inferOutput<Api["knowledge"]["kindConcepts"]>["concepts"][number];

export const useKnowledgeTree = () => {
  const api = useTRPC();
  return useQuery(api.knowledge.tree.queryOptions(undefined, WHILE_A_CEILING_HOLDS));
};

export const useKindConcepts = (open: OpenKind) => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.knowledge.kindConcepts.infiniteQueryOptions(
      open === undefined ? skipToken : { collection: open.collection, kind: open.kind },
      { getNextPageParam: (page) => page.nextCursor, ...WHILE_A_CEILING_HOLDS },
    ),
  );
};

export type KindConceptsRead = ReturnType<typeof useKindConcepts>;

type Collections = inferOutput<Api["knowledge"]["collections"]>;

export type CollectionOwned = Collections["collections"][number];

export type Owner = NonNullable<CollectionOwned["owner"]>;

type Members = inferOutput<Api["members"]["list"]>;

type OwnerAsked = inferInput<Api["knowledge"]["nameOwner"]>;

export const useCollections = () => {
  const api = useTRPC();
  return useQuery(api.knowledge.collections.queryOptions());
};

const ownerOf = (member: Members[number]): Owner => ({
  id: member.personId,
  name: member.displayName,
});

const choicesOf = (members: Members): readonly Owner[] =>
  members.map(ownerOf).toSorted((one, other) => one.name.localeCompare(other.name));

const NO_CHOICES: readonly Owner[] = [];

export const useOwnerChoices = (askedByAnAdmin: boolean): readonly Owner[] => {
  const api = useTRPC();
  return (
    useQuery(
      api.members.list.queryOptions(undefined, { enabled: askedByAnAdmin, select: choicesOf }),
    ).data ?? NO_CHOICES
  );
};

const ownerFrom = (
  members: Members | undefined,
  personId: string | null,
): Owner | null | undefined => {
  if (personId === null) return null;
  const member = members?.find((each) => each.personId === personId);
  return member === undefined ? undefined : ownerOf(member);
};

const ownedAsAsked =
  (asked: OwnerAsked, owner: Owner | null | undefined) =>
  (held: Collections): Collections => ({
    ...held,
    collections: held.collections.map((owned) =>
      owner !== undefined && "collection" in asked && owned.collection === asked.collection
        ? { ...owned, owner }
        : owned,
    ),
  });

export const useNameOwner = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const optimistic = useOptimistic();
  return useMutation(
    api.knowledge.nameOwner.mutationOptions<Undo>({
      onMutate: (asked) => {
        const members = queryClient.getQueryData(api.members.list.queryKey());
        return optimistic(
          api.knowledge.collections.queryKey(),
          ownedAsAsked(asked, ownerFrom(members, asked.personId)),
        );
      },
      onError: (_refusal, _asked, taken) => {
        taken?.undo();
        void queryClient.invalidateQueries({ queryKey: api.members.list.queryKey() });
      },
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: api.knowledge.collections.queryKey() }),
          queryClient.invalidateQueries({ queryKey: memberOptions(api).queryKey }),
        ]),
    }),
  );
};
