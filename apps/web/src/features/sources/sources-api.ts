import {
  useMutation,
  useQuery,
  useQueryClient,
  type DataTag,
  type QueryKey,
} from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { uploadOptions, type UploadDescriptor } from "@/shared/api/link.ts";
import { useTRPC, useTRPCClient } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

export type ListedBinding = inferOutput<Api["sources"]["list"]>[number];

export type FindingGroup = inferOutput<Api["sources"]["findings"]>[number];

export type FindingGroupKey = Pick<FindingGroup, "documentId" | "category" | "ruleId" | "tier">;

export type DocumentsNarrowed = inferOutput<Api["sources"]["narrowDocuments"]>;

export type BindingNarrowed = inferOutput<Api["sources"]["narrow"]>;

export type Sensitivity = ListedBinding["sensitivity"];

// Narrowest first, the order a narrowing moves in.
export const CLASSES: readonly Sensitivity[] = ["Restricted", "Internal", "Public"];

export const NARROWEST: Sensitivity = "Restricted";

const RUN_IN_FLIGHT: ReadonlySet<string> = new Set(["queued", "claimed"]);

const WATCHING_A_RUN_MS = 1000;

const aRunIsInFlight = (bindings: readonly ListedBinding[] | undefined): boolean =>
  (bindings ?? []).some(
    (binding) => binding.lastRun !== null && RUN_IN_FLIGHT.has(binding.lastRun.status),
  );

export const useBindings = () => {
  const api = useTRPC();
  return useQuery({
    ...api.sources.list.queryOptions(),
    // A run in flight moves the state word, so the list watches until every run has landed.
    refetchInterval: (query) => (aRunIsInFlight(query.state.data) ? WATCHING_A_RUN_MS : false),
  });
};

export const useFindings = (bindingId: string) => {
  const api = useTRPC();
  return useQuery(api.sources.findings.queryOptions({ bindingId }));
};

export const usePreview = (bindingId: string, enabled: boolean) => {
  const api = useTRPC();
  return useQuery({ ...api.sources.preview.queryOptions({ bindingId }), enabled });
};

// The one act whose input is bytes: its descriptor rides beside them, so it goes through the
// client rather than an options factory built once.
export const useBind = () => {
  const api = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (asked: { readonly file: Blob; readonly descriptor: UploadDescriptor }) =>
      client.sources.bind.mutate(asked.file, uploadOptions(asked.descriptor)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: api.sources.list.queryKey() }),
  });
};

type Undo = { readonly undo: () => void };

// A click must read as done within a tenth of a second, so the cache takes the act before the
// api answers.
const useOptimistic = () => {
  const queryClient = useQueryClient();
  return async <Data>(
    queryKey: DataTag<QueryKey, Data, unknown>,
    change: (data: Data) => Data,
  ): Promise<Undo> => {
    await queryClient.cancelQueries({ queryKey });
    const before = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (held) => (held === undefined ? held : change(held)));
    return {
      undo: () => {
        queryClient.setQueryData(queryKey, before);
      },
    };
  };
};

// Every settled act reads again what it changed, so the cache ends as the api left it.
const useReconcile = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return (bindingId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: api.sources.list.queryKey() }),
      bindingId === undefined
        ? undefined
        : queryClient.invalidateQueries({ queryKey: api.sources.findings.queryKey({ bindingId }) }),
    ]);
};

const onTheBinding =
  (bindingId: string, change: (binding: ListedBinding) => ListedBinding) =>
  (list: readonly ListedBinding[]) =>
    list.map((binding) => (binding.bindingId === bindingId ? change(binding) : binding));

export const usePublish = () => {
  const api = useTRPC();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  return useMutation(
    api.sources.publish.mutationOptions({
      onMutate: (asked) =>
        optimistic(
          api.sources.list.queryKey(),
          onTheBinding(asked.bindingId, (binding) => ({
            ...binding,
            state: "published",
            publishedAt: new Date().toISOString(),
          })),
        ),
      onError: (_refusal, _asked, held) => held?.undo(),
      onSettled: () => reconcile(),
    }),
  );
};

export const useNarrowBinding = () => {
  const api = useTRPC();
  const optimistic = useOptimistic();
  const reconcile = useReconcile();
  return useMutation(
    api.sources.narrow.mutationOptions({
      onMutate: (asked) =>
        optimistic(
          api.sources.list.queryKey(),
          onTheBinding(asked.bindingId, (binding) => ({
            ...binding,
            sensitivity: CLASSES.find((word) => word === asked.sensitivity) ?? binding.sensitivity,
          })),
        ),
      onError: (_refusal, _asked, held) => held?.undo(),
      onSettled: () => reconcile(),
    }),
  );
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

// What a group is, as one string for a list's key: it names no finding and no span.
export const groupKeyText = (group: FindingGroupKey): string =>
  [group.documentId, group.category, group.ruleId, group.tier].join(" ");

export const useKeepInText = () => {
  const api = useTRPC();
  const reconcile = useReconcile();
  return useMutation(
    api.sources.keepInText.mutationOptions({
      onSettled: (_kept, _refusal, asked) => reconcile(asked.bindingId),
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
        return optimistic(api.sources.findings.queryKey({ bindingId: asked.bindingId }), (groups) =>
          groups.map((group) =>
            narrowed.has(group.documentId) ? { ...group, sensitivity: NARROWEST } : group,
          ),
        );
      },
      onError: (_refusal, _asked, held) => held?.undo(),
      onSettled: (_narrowed, _refusal, asked) => reconcile(asked.bindingId),
    }),
  );
};
