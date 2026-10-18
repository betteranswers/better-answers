import { useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

import { WHILE_A_CEILING_HOLDS } from "@/shared/api/query-client.ts";
import { useTRPC } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

export const usePassage = (locator: string) => {
  const api = useTRPC();
  return useQuery(api.knowledge.open.queryOptions({ locator }, WHILE_A_CEILING_HOLDS));
};

export type Concept = NonNullable<inferOutput<Api["knowledge"]["open"]>["concept"]>;

export type Evidence = Concept["evidence"][number];

export type Opening =
  | { readonly kind: "passage"; readonly locator: string }
  | { readonly kind: "concept"; readonly iri: string };

export const openingOf = (item: Evidence | undefined): Opening | undefined => {
  if (item?.locator !== undefined) return { kind: "passage", locator: item.locator };
  return item?.iri === undefined ? undefined : { kind: "concept", iri: item.iri };
};

export const useConcept = (iri: string) => {
  const api = useTRPC();
  return useQuery(api.knowledge.open.queryOptions({ iri }, WHILE_A_CEILING_HOLDS));
};
