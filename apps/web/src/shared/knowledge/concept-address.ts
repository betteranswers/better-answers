import { z } from "zod";

import { CONCEPT_IRI_PREFIX, IRI, ulidOfConceptIri } from "@better-answers/schema/concept-file";

import { detailAt, KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

export const BROWSE = menuGroupIn(KNOWLEDGE, "browse");

export const SEARCH_PAGE = pageNamed(BROWSE, "Search");

const iriOf = (segment: string): string => `${CONCEPT_IRI_PREFIX}${segment}`;

export const CONCEPT_IRI = z
  .string()
  .transform(iriOf)
  .refine((iri) => IRI.test(iri));

export const conceptPageOf = (iri: string): string | undefined => {
  const ulid = ulidOfConceptIri(iri);
  return ulid === undefined ? undefined : detailAt(SEARCH_PAGE, ulid);
};

export const conceptMatchKey = (iri: string): string => `bundles:${iri}`;

const SEARCH_QUERY = z.string().startsWith("?").optional().catch(undefined);

export const searchAt = (query: string | undefined): string => `${SEARCH_PAGE.path}${query ?? ""}`;

export const OPENED_FROM = z.object({ searchQuery: SEARCH_QUERY });

export const RETURNED_TO = z.object({ openedMatch: z.string().optional().catch(undefined) });
