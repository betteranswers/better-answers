import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";

import { uploadOptions, type UploadDescriptor } from "@/shared/api/link.ts";
import { useOptimistic, type Undo } from "@/shared/api/optimistic.ts";
import { useTRPC, useTRPCClient, type ApiError } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

export type ListedConnectedSource = inferOutput<Api["sources"]["list"]>[number];

export type FindingGroup = inferOutput<Api["sources"]["findings"]>[number];

export type FindingGroupKey = Pick<FindingGroup, "documentId" | "category" | "ruleId" | "tier">;

export type DocumentsNarrowed = inferOutput<Api["sources"]["narrowDocuments"]>;

export type ConnectedSourceNarrowed = inferOutput<Api["sources"]["narrow"]>;

export type ConnectedSourceWidened = inferOutput<Api["sources"]["widen"]>;

export type DismissedAsNotSpecialCategory = inferOutput<
  Api["sources"]["dismissAsNotSpecialCategory"]
>;

export type Sensitivity = ListedConnectedSource["sensitivity"];

/** Narrowest first, the order a narrowing moves in. */
export const CLASSES: readonly Sensitivity[] = ["Restricted", "Internal", "Public"];

export const NARROWEST: Sensitivity = "Restricted";

const WIDEST: Sensitivity = "Public";

export const EVERYONE: ListedConnectedSource["audience"] = "everyone";

export const widestAlready = (connectedSource: ListedConnectedSource): boolean =>
  connectedSource.sensitivity === WIDEST && connectedSource.audience === EVERYONE;

const SYNC_IN_FLIGHT: ReadonlySet<string> = new Set(["queued", "claimed"]);

const WATCHING_A_SYNC_MS = 1000;

const aSyncIsInFlight = (connectedSources: readonly ListedConnectedSource[] | undefined): boolean =>
  (connectedSources ?? []).some(
    (connectedSource) =>
      connectedSource.lastSync !== null && SYNC_IN_FLIGHT.has(connectedSource.lastSync.status),
  );

export const useConnectedSources = () => {
  const api = useTRPC();
  return useQuery({
    ...api.sources.list.queryOptions(),
    // A sync in flight moves the state word, so the list watches until every sync has landed.
    refetchInterval: (query) => (aSyncIsInFlight(query.state.data) ? WATCHING_A_SYNC_MS : false),
  });
};

export const useFindings = (connectedSourceId: string) => {
  const api = useTRPC();
  return useQuery(api.sources.findings.queryOptions({ connectedSourceId }));
};

export const usePreview = (connectedSourceId: string, enabled: boolean) => {
  const api = useTRPC();
  return useQuery({ ...api.sources.preview.queryOptions({ connectedSourceId }), enabled });
};

/**
 * The one act whose input is bytes: its descriptor rides beside them, so it goes through the
 * tRPC client, not an options factory built once.
 */
export const useConnect = () => {
  const api = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (asked: { readonly file: Blob; readonly descriptor: UploadDescriptor }) =>
      client.sources.connect.mutate(asked.file, uploadOptions(asked.descriptor)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: api.sources.list.queryKey() }),
  });
};

/** Every settled act reads again what it changed, so the cache ends as the api left it. */
const useReconcile = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return (connectedSourceId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: api.sources.list.queryKey() }),
      connectedSourceId === undefined
        ? undefined
        : queryClient.invalidateQueries({
            queryKey: api.sources.findings.queryKey({ connectedSourceId }),
          }),
    ]);
};

const onTheConnectedSource =
  (
    connectedSourceId: string,
    change: (connectedSource: ListedConnectedSource) => ListedConnectedSource,
  ) =>
  (list: readonly ListedConnectedSource[]) =>
    list.map((connectedSource) =>
      connectedSource.connectedSourceId === connectedSourceId
        ? change(connectedSource)
        : connectedSource,
    );

export const usePublish = () => {
  const api = useTRPC();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  return useMutation(
    api.sources.publish.mutationOptions({
      onMutate: (asked) =>
        optimistic(
          api.sources.list.queryKey(),
          onTheConnectedSource(asked.connectedSourceId, (connectedSource) => ({
            ...connectedSource,
            state: "published",
            publishedAt: new Date().toISOString(),
          })),
        ),
      onError: (_refusal, _asked, held) => held?.undo(),
      onSettled: () => reconcile(),
    }),
  );
};

/**
 * Text until parsed: the input's class and audience are the api's words as the wire carries
 * them.
 */
type ClassAsked = inferInput<Api["sources"]["widen"]>;

const classSetAsAsked =
  (asked: ClassAsked) =>
  (connectedSource: ListedConnectedSource): ListedConnectedSource => {
    const sensitivity =
      CLASSES.find((word) => word === asked.sensitivity) ?? connectedSource.sensitivity;
    return asked.audience === EVERYONE
      ? { ...connectedSource, sensitivity, audience: EVERYONE, audienceGroups: null }
      : { ...connectedSource, sensitivity };
  };

/** A narrowing and a widening draw the same class on the row, and undo it the same way. */
const useClassSetOnTheRow = () => {
  const api = useTRPC();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  return {
    onMutate: (asked: ClassAsked) =>
      optimistic(
        api.sources.list.queryKey(),
        onTheConnectedSource(asked.connectedSourceId, classSetAsAsked(asked)),
      ),
    onError: (_refusal: ApiError, _asked: ClassAsked, held: Undo | undefined) => held?.undo(),
    onSettled: () => reconcile(),
  };
};

export const useNarrowConnectedSource = () => {
  const api = useTRPC();
  return useMutation(api.sources.narrow.mutationOptions(useClassSetOnTheRow()));
};

export const useWidenConnectedSource = () => {
  const api = useTRPC();
  return useMutation(api.sources.widen.mutationOptions(useClassSetOnTheRow()));
};

const sameGroup = (left: FindingGroupKey, right: FindingGroupKey): boolean =>
  left.documentId === right.documentId &&
  left.category === right.category &&
  left.ruleId === right.ruleId &&
  left.tier === right.tier;

export const groupIsIn = (groups: readonly FindingGroupKey[], group: FindingGroupKey): boolean =>
  groups.some((held) => sameGroup(held, group));

export const keyOf = (group: FindingGroupKey): FindingGroupKey => ({
  documentId: group.documentId,
  category: group.category,
  ruleId: group.ruleId,
  tier: group.tier,
});

/** What a group is, as one string for a list's key: it names no finding and no span. */
export const groupKeyText = (group: FindingGroupKey): string =>
  [group.documentId, group.category, group.ruleId, group.tier].join(" ");

export const useKeepInText = () => {
  const api = useTRPC();
  const reconcile = useReconcile();
  return useMutation(
    api.sources.keepInText.mutationOptions({
      onSettled: (_kept, _refusal, asked) => reconcile(asked.connectedSourceId),
    }),
  );
};

export const useNarrowDocuments = () => {
  const api = useTRPC();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  return useMutation(
    api.sources.narrowDocuments.mutationOptions({
      onMutate: (asked) => {
        const narrowed = new Set(asked.findingGroups.map((group) => group.documentId));
        return optimistic(
          api.sources.findings.queryKey({ connectedSourceId: asked.connectedSourceId }),
          (groups) =>
            groups.map((group) =>
              narrowed.has(group.documentId) ? { ...group, sensitivity: NARROWEST } : group,
            ),
        );
      },
      onError: (_refusal, _asked, held) => held?.undo(),
      onSettled: (_narrowed, _refusal, asked) => reconcile(asked.connectedSourceId),
    }),
  );
};

export const useDismissAsNotSpecialCategory = () => {
  const api = useTRPC();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  return useMutation(
    api.sources.dismissAsNotSpecialCategory.mutationOptions({
      onMutate: (asked) =>
        optimistic(
          api.sources.findings.queryKey({ connectedSourceId: asked.connectedSourceId }),
          (groups) =>
            groups.map((group) =>
              groupIsIn(asked.findingGroups, group) ? { ...group, dismissed: group.found } : group,
            ),
        ),
      onError: (_refusal, _asked, held) => held?.undo(),
      onSettled: (_dismissed, _refusal, asked) => reconcile(asked.connectedSourceId),
    }),
  );
};
