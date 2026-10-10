import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { retryUnlessWaiting } from "@/shared/api/query-client.ts";
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
      { getNextPageParam: (page) => page.nextCursor, retry: retryUnlessWaiting },
    ),
  );
};

export type Matches = ReturnType<typeof useMatches>;

export const usePassage = (locator: string) => {
  const api = useTRPC();
  return useQuery(api.knowledge.open.queryOptions({ locator }, { retry: retryUnlessWaiting }));
};

export type Concept = NonNullable<inferOutput<Api["knowledge"]["open"]>["concept"]>;

/** One of a concept's sources as its reader may see it: `locator` or `iri` only where it opens. */
export type Evidence = Concept["evidence"][number];

/** A refused read is never asked again: a withheld concept stays withheld, and a ceiling lifts with time. */
export const useConcept = (iri: string) => {
  const api = useTRPC();
  return useQuery(api.knowledge.open.queryOptions({ iri }, { retry: retryUnlessWaiting }));
};
