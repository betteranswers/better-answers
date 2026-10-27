import { useQuery, type QueryClient } from "@tanstack/react-query";

import { refusalOf, useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";

const standingOptions = (api: ApiProxy) =>
  api.session.operator.queryOptions(undefined, { refetchOnMount: false });

export const useOperatorStanding = () => {
  const api = useTRPC();
  return useQuery(standingOptions(api));
};

export const mustSignInForTheConsole = async (
  queryClient: QueryClient,
  api: ApiProxy,
  afresh: boolean,
): Promise<boolean> => {
  const asked = { ...standingOptions(api), retry: false };
  try {
    await queryClient.query(afresh ? asked : { ...asked, staleTime: "static" });
    return false;
  } catch (error) {
    return error instanceof Error && refusalOf(error)?.class === "unauthenticated";
  }
};

export const isTheOperator = async (
  queryClient: QueryClient,
  api: ApiProxy,
  afresh: boolean,
): Promise<boolean> => {
  const asked = { ...standingOptions(api), retry: false };
  try {
    const standing = await queryClient.query(afresh ? asked : { ...asked, staleTime: "static" });
    return standing.operator;
  } catch {
    return false;
  }
};
