import { useInfiniteQuery } from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

type AuditLogProcedure = ReturnType<typeof useTRPC>["members"]["auditLog"];

export type ReadAuditEvent = inferOutput<AuditLogProcedure>["events"][number];

export type Family = NonNullable<inferInput<AuditLogProcedure>["family"]>;

/** Newest first, a page at a time; no family reads them all. */
export const useAuditLog = (family: Family | undefined) => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.members.auditLog.infiniteQueryOptions(family === undefined ? {} : { family }, {
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
};

export type AuditLog = ReturnType<typeof useAuditLog>;
