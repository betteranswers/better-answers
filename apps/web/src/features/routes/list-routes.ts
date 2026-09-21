import { useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

export type WorkspaceRoute = inferOutput<ReturnType<typeof useTRPC>["routes"]["list"]>[number];

export const useWorkspaceRoutes = () => {
  const api = useTRPC();
  return useQuery(api.routes.list.queryOptions());
};
