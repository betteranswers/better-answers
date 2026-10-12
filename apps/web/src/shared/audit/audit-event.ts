import type { inferOutput } from "@trpc/tanstack-react-query";

import type { useTRPC } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

export type ReadAuditEvent = inferOutput<Api["members"]["auditLog"]>["events"][number];
