import { z } from "zod";

import { CONCEPT_IRI_PREFIX, IRI, ulidOfConceptIri } from "@better-answers/schema/concept-file";

import { detailAt, KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

export const BROWSE = menuGroupIn(KNOWLEDGE, "browse");

export const SEARCH_PAGE = pageNamed(BROWSE, "Search");

const iriOf = (segment: string): string => `${CONCEPT_IRI_PREFIX}${segment}`;

/** The address's segment as the read takes it. Anything else names no concept, so nothing is asked. */
export const CONCEPT_IRI = z
  .string()
  .transform(iriOf)
  .refine((iri) => IRI.test(iri));

/** Undefined for anything but a concept's IRI, so no other address is ever sent to a page here. */
export const conceptPageOf = (iri: string): string | undefined => {
  const ulid = ulidOfConceptIri(iri);
  return ulid === undefined ? undefined : detailAt(SEARCH_PAGE, ulid);
};

/** A concept match's key on Search, which both its row and the way back to it name. */
export const conceptMatchKey = (iri: string): string => `bundles:${iri}`;

/** The query Search was left at, which only ever begins a query. */
const SEARCH_QUERY = z.string().startsWith("?").optional().catch(undefined);

/** Search with the query its reader left it at, so the way back finds the same matches. */
export const searchAt = (query: string | undefined): string => `${SEARCH_PAGE.path}${query ?? ""}`;

/** Asked of a concept's page through its history entry: where Search was when it opened. */
export const OPENED_FROM = z.object({ searchQuery: SEARCH_QUERY });

/** Kept by Search's own history entry: the match whose page was opened, where focus goes back. */
export const RETURNED_TO = z.object({ openedMatch: z.string().optional().catch(undefined) });
