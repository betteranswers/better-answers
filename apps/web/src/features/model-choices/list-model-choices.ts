import { useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

export type WorkspaceModelChoice = inferOutput<
  ReturnType<typeof useTRPC>["modelChoices"]["list"]
>[number];

export const useWorkspaceModelChoices = () => {
  const api = useTRPC();
  return useQuery(api.modelChoices.list.queryOptions());
};
