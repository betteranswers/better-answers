import { z } from "zod";

import { CONCEPT_IRI_PREFIX, IRI, ulidOfConceptIri } from "@better-answers/schema/concept-file";

import {
  detailAt,
  KNOWLEDGE,
  menuGroupIn,
  pageNamed,
  placeAt,
  type Area,
  type Page,
  type Place,
} from "@/shared/navigation.ts";

export const BROWSE = menuGroupIn(KNOWLEDGE, "browse");

export const SEARCH_PAGE = pageNamed(BROWSE, "Search");

export const KNOWLEDGE_BASE_PAGE = pageNamed(BROWSE, "Knowledge Base");

const OPENED_FROM_PAGES: readonly Page[] = [SEARCH_PAGE, KNOWLEDGE_BASE_PAGE];

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

const pathOf = (address: string): string => address.split("?")[0] ?? address;

const pageOpenedFrom = (address: string): Page | undefined =>
  OPENED_FROM_PAGES.find((page) => pathOf(address) === page.path);

export const OPENED_FROM = z.object({
  openedFrom: z
    .string()
    .refine((address) => pageOpenedFrom(address) !== undefined)
    .optional()
    .catch(undefined),
});

export const wayBackOf = (
  openedFrom: string | undefined,
): { readonly page: Page; readonly href: string } => {
  const page = openedFrom === undefined ? undefined : pageOpenedFrom(openedFrom);
  return page === undefined
    ? { page: SEARCH_PAGE, href: SEARCH_PAGE.path }
    : { page, href: openedFrom ?? page.path };
};

export const placeOpenedFrom = <Held extends Area>(
  areas: readonly Held[],
  pathname: string,
  openedFrom: string | undefined,
): Place<Held> | undefined => {
  const here = placeAt(areas, pathname);
  if (here?.page !== SEARCH_PAGE || here.detail === undefined || openedFrom === undefined) {
    return here;
  }
  const origin = placeAt(areas, wayBackOf(openedFrom).page.path);
  return origin === undefined ? here : { ...origin, detail: here.detail };
};

export const RETURNED_TO = z.object({ openedMatch: z.string().optional().catch(undefined) });
