import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { WHILE_A_CEILING_HOLDS } from "@/shared/api/query-client.ts";
import { useTRPC } from "@/shared/api/trpc.ts";

import { MATCHES_A_PAGE } from "./knowledge-state.ts";

type Api = ReturnType<typeof useTRPC>;

export type Match = inferOutput<Api["knowledge"]["find"]>["matches"][number];

export type ConceptMatch = Extract<Match, { readonly layer: "bundles" }>;

export type PassageMatch = Extract<Match, { readonly layer: "sources" }>;

export const asksNothing = (query: string): boolean => query.trim() === "";

export const useMatches = (query: string) => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.knowledge.find.infiniteQueryOptions(
      asksNothing(query) ? skipToken : { query, limit: MATCHES_A_PAGE },
      { getNextPageParam: (page) => page.nextCursor, ...WHILE_A_CEILING_HOLDS },
    ),
  );
};

export type Matches = ReturnType<typeof useMatches>;
