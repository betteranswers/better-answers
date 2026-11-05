import {
  keepPreviousData,
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
import { memberOptions } from "@/shared/member/member.ts";

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

export type EditRead = inferOutput<Api["knowledge"]["conceptToEdit"]>;

export type EditAsked = inferInput<Api["knowledge"]["conceptToEdit"]>;

export type SaveAsked = inferInput<Api["knowledge"]["saveConcept"]>;

export type Saved = inferOutput<Api["knowledge"]["saveConcept"]>;

export type SourceEntry = EditRead["sources"][number];

export const useReadToEdit = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return (asked: EditAsked): Promise<EditRead> =>
    queryClient.query({
      ...api.knowledge.conceptToEdit.queryOptions(asked),
      staleTime: 0,
      gcTime: 0,
    });
};

export const useSaveConcept = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const saving = useMutation(
    api.knowledge.saveConcept.mutationOptions({
      onSettled: () => queryClient.invalidateQueries(api.knowledge.pathFilter()),
    }),
  );
  return (asked: SaveAsked): Promise<Saved> => saving.mutateAsync(asked);
};

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

export type GuideSummary = inferOutput<Api["knowledge"]["guides"]>[number];

export type Guide = inferOutput<Api["knowledge"]["guide"]>;

export type GuideSection = Guide["sections"][number];

export type SectionFact = GuideSection["coverage"]["facts"][number];

export type SectionBrief = NonNullable<GuideSection["brief"]>;

export type BriefAsked = inferInput<Api["knowledge"]["saveBrief"]>;

export type BriefSaved = inferOutput<Api["knowledge"]["saveBrief"]>;

export const useGuides = () => {
  const api = useTRPC();
  return useQuery(api.knowledge.guides.queryOptions(undefined, WHILE_A_CEILING_HOLDS));
};

export const useGuide = (guideId: string | undefined) => {
  const api = useTRPC();
  return useQuery(
    api.knowledge.guide.queryOptions(
      guideId === undefined ? skipToken : { guideId },
      WHILE_A_CEILING_HOLDS,
    ),
  );
};

export const useSaveBrief = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const saving = useMutation(
    api.knowledge.saveBrief.mutationOptions({
      onSettled: () => queryClient.invalidateQueries(api.knowledge.pathFilter()),
    }),
  );
  return (asked: BriefAsked): Promise<BriefSaved> => saving.mutateAsync(asked);
};

export type BriefCopied = inferOutput<Api["knowledge"]["briefCopy"]>;

export const useBriefCopy = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const recording = useMutation(api.knowledge.recordCopy.mutationOptions());
  return {
    read: (writeUpId: string): Promise<BriefCopied> =>
      queryClient.query({
        ...api.knowledge.briefCopy.queryOptions({ writeUpId }),
        staleTime: 0,
        gcTime: 0,
      }),
    record: async (writeUpId: string, version: number): Promise<void> => {
      await recording.mutateAsync({ writeUpId, version });
    },
  };
};

export const useIncludeAvailable = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const including = useMutation(
    api.knowledge.includeAvailable.mutationOptions({
      onSettled: () => queryClient.invalidateQueries(api.knowledge.pathFilter()),
    }),
  );
  return (writeUpId: string): Promise<{ readonly included: number }> =>
    including.mutateAsync({ writeUpId });
};

export type AllKnowledgeAsked = inferInput<Api["knowledge"]["allKnowledge"]>;

export type AllKnowledge = inferOutput<Api["knowledge"]["allKnowledge"]>;

export type AllKnowledgeRow = AllKnowledge["rows"][number];

export const useAllKnowledge = (asked: AllKnowledgeAsked) => {
  const api = useTRPC();
  return useQuery(
    api.knowledge.allKnowledge.queryOptions(asked, { placeholderData: keepPreviousData }),
  );
};

export type KindCounted = inferOutput<Api["knowledge"]["kinds"]>["kinds"][number];

export const useKinds = () => {
  const api = useTRPC();
  return useQuery(api.knowledge.kinds.queryOptions());
};

export const useSetOwners = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.knowledge.setOwners.mutationOptions({
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries(api.knowledge.allKnowledge.pathFilter()),
          queryClient.invalidateQueries({ queryKey: api.knowledge.collections.queryKey() }),
          queryClient.invalidateQueries({ queryKey: memberOptions(api).queryKey }),
        ]),
    }),
  );
};

export type KnowledgeBaseExported = inferOutput<Api["knowledge"]["exportBundle"]>;

export type RecordsExported = inferOutput<Api["knowledge"]["exportRecords"]>;

export type GuideExported = inferOutput<Api["knowledge"]["exportGuide"]>;

export const useExportKnowledgeBase = (saved: (answer: KnowledgeBaseExported) => void) => {
  const api = useTRPC();
  return useMutation(api.knowledge.exportBundle.mutationOptions({ onSuccess: saved }));
};

export const useExportRecords = (saved: (answer: RecordsExported) => void) => {
  const api = useTRPC();
  return useMutation(api.knowledge.exportRecords.mutationOptions({ onSuccess: saved }));
};

export const useExportGuide = (saved: (answer: GuideExported) => void) => {
  const api = useTRPC();
  return useMutation(api.knowledge.exportGuide.mutationOptions({ onSuccess: saved }));
};
