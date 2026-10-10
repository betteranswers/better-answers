import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { useTRPC } from "@/shared/api/trpc.ts";

import { MATCHES_A_PAGE } from "./knowledge-state.ts";

type Api = ReturnType<typeof useTRPC>;

export type Match = inferOutput<Api["knowledge"]["find"]>["matches"][number];

export type ConceptMatch = Extract<Match, { readonly layer: "bundles" }>;

export type PassageMatch = Extract<Match, { readonly layer: "sources" }>;

/** Spaces alone ask for nothing, so they send nothing. */
export const asksNothing = (query: string): boolean => query.trim() === "";

/** A page at a time, after each page's cursor; a query of spaces alone sends nothing. */
export const useMatches = (query: string) => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.knowledge.find.infiniteQueryOptions(
      asksNothing(query) ? skipToken : { query, limit: MATCHES_A_PAGE },
      { getNextPageParam: (page) => page.nextCursor },
    ),
  );
};

export type Matches = ReturnType<typeof useMatches>;

export const usePassage = (locator: string) => {
  const api = useTRPC();
  return useQuery(api.knowledge.open.queryOptions({ locator }));
};

export type PassageRead = ReturnType<typeof usePassage>;
