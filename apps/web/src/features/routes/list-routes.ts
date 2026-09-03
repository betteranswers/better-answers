import { useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

/**
 * The routes feature's one request. A feature owns the requests it issues and `shared/` owns
 * the client they go through (ADR 0006's 2026-09-02 amendment, the bulletproof-react api-layer
 * pattern), so this is where `routes.list` is named and the only place it is named.
 *
 * The procedure takes no argument: the workspace is the session's, resolved inside the
 * transaction that authorises the read (`apps/api/src/trpc/base.ts`). There is nothing for a
 * caller to pass, and so nothing a caller could pass to reach another workspace's rows.
 */

/**
 * One purpose's choice, as the wire hands it over. Read off the client rather than declared
 * here: the api's own shape reaches this screen with no generated file between the two
 * workspaces, so a field the procedure stops answering is a type error here and not a blank
 * cell in a browser.
 */
export type WorkspaceRoute = inferOutput<ReturnType<typeof useTRPC>["routes"]["list"]>[number];

export const useWorkspaceRoutes = () => {
  const api = useTRPC();
  return useQuery(api.routes.list.queryOptions());
};
