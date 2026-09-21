import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

export const useMembership = () => {
  const trpc = useTRPC();
  return useQuery(trpc.session.membership.queryOptions());
};

type Refused = {
  readonly data?: { readonly code?: string } | null | undefined;
  readonly message: string;
};

export const refusalOf = (error: Refused | null): string | undefined =>
  error !== null && error.data?.code === "UNAUTHORIZED" ? error.message : undefined;

export const NEEDS_A_PICK = "no-active-workspace";
