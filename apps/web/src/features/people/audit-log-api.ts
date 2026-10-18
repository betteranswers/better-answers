import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferInput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

type AuditLogProcedure = Api["members"]["auditLog"];

export type Family = NonNullable<inferInput<AuditLogProcedure>["family"]>;

export type Asked = { readonly family: Family | undefined; readonly search: string };

const inputOf = (asked: Asked) => ({
  family: asked.family,
  search: asked.search === "" ? undefined : asked.search,
});

export const useAuditLog = (asked: Asked) => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.members.auditLog.infiniteQueryOptions(inputOf(asked), {
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
};

export type AuditLog = ReturnType<typeof useAuditLog>;

export const useExportAuditLog = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const exporting = useMutation(
    api.members.exportAuditLog.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(api.members.auditLog.pathFilter());
      },
    }),
  );
  return {
    ...exporting,
    exportFor: (asked: Asked) => exporting.mutateAsync(inputOf(asked)),
  };
};
