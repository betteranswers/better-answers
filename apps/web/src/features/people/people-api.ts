import { useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

export type ListedMember = inferOutput<ReturnType<typeof useTRPC>["members"]["list"]>[number];

export const useMembers = () => {
  const api = useTRPC();
  return useQuery(api.members.list.queryOptions());
};
