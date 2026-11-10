import { z } from "zod";

import { PAGE_NUMBER, searchText } from "@/shared/address/list-address.ts";
import type { Keystroke } from "@/shared/keystrokes.tsx";
import { KNOWLEDGE, menuGroupIn, pageById } from "@/shared/navigation.ts";

import type { AllKnowledgeAsked } from "../knowledge-api.ts";

export const ALL_KNOWLEDGE_KEYSTROKES = {
  open: { key: "o", action: "Open the focused concept" },
  tick: { key: "x", action: "Select or clear the focused concept" },
  setOwner: { key: "O", action: "Set the owner of the selected concepts" },
  clearSelection: { key: "Escape", action: "Clear the selection" },
  previousPage: { key: "[", action: "Show the previous page" },
  nextPage: { key: "]", action: "Show the next page" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const ALL_KNOWLEDGE_LIST = "all";

const SORTS = [
  "title",
  "-title",
  "type",
  "-type",
  "collection",
  "-collection",
  "owner",
  "-owner",
  "trust",
  "-trust",
] as const;

type Sort = (typeof SORTS)[number];

type Sorted = AllKnowledgeAsked["sort"];

const SORTED = {
  title: { column: "title", desc: false },
  "-title": { column: "title", desc: true },
  type: { column: "type", desc: false },
  "-type": { column: "type", desc: true },
  collection: { column: "collection", desc: false },
  "-collection": { column: "collection", desc: true },
  owner: { column: "owner", desc: false },
  "-owner": { column: "owner", desc: true },
  trust: { column: "trust", desc: false },
  "-trust": { column: "trust", desc: true },
} as const satisfies Readonly<Record<Sort, Sorted>>;

export const SORTABLE: ReadonlySet<string> = new Set(
  Object.values(SORTED).map(({ column }) => column),
);

type TrustAsked = NonNullable<AllKnowledgeAsked["trust"]>;

export const TRUSTS = [
  "unverified",
  "out-of-date",
  "changed-since-checked",
  "deprecated",
] as const satisfies readonly TrustAsked[];

export const trustChosen = (choice: string | undefined): TrustAsked | undefined =>
  TRUSTS.find((trust) => trust === choice);

export const ALL_KNOWLEDGE_FIELDS = {
  collection: searchText(),
  type: searchText(),
  trust: z.enum(TRUSTS).optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  page: PAGE_NUMBER,
};

export const sortedOf = (sort: Sort | undefined): Sorted =>
  sort === undefined ? SORTED.title : SORTED[sort];

export const sortOf = (sorted: { readonly id: string; readonly desc: boolean }): Sort | undefined =>
  SORTS.find((sort) => sort === `${sorted.desc ? "-" : ""}${sorted.id}`);

const NOTHING_HELD = "";

const EVERY_COLLECTION_HELD = "every collection";

export const YOUR_COLLECTIONS = "your collections";

export type CollectionScope =
  | { readonly kind: "every" }
  | { readonly kind: "owned" }
  | { readonly kind: "one"; readonly collection: string };

const EVERY: CollectionScope = { kind: "every" };

const OWNED: CollectionScope = { kind: "owned" };

export const scopeOf = (held: string, ownerOnly: boolean): CollectionScope => {
  if (held === EVERY_COLLECTION_HELD) return EVERY;
  if (held !== NOTHING_HELD) return { kind: "one", collection: held };
  return ownerOnly ? OWNED : EVERY;
};

export const heldFor = (picked: string | undefined, ownerOnly: boolean): string => {
  if (picked === undefined) return ownerOnly ? EVERY_COLLECTION_HELD : NOTHING_HELD;
  return picked === YOUR_COLLECTIONS ? NOTHING_HELD : picked;
};

const collectionsOf = (scope: CollectionScope, owned: readonly string[]): string[] => {
  switch (scope.kind) {
    case "every":
      return [];
    case "owned":
      return [...owned];
    case "one":
      return [scope.collection];
  }
};

export const choiceOf = (scope: CollectionScope, owned: readonly string[]): string | undefined => {
  switch (scope.kind) {
    case "every":
      return undefined;
    case "owned":
      return owned.length === 1 ? owned[0] : YOUR_COLLECTIONS;
    case "one":
      return scope.collection;
  }
};

export type Held = z.output<z.ZodObject<typeof ALL_KNOWLEDGE_FIELDS>>;

export const allKnowledgeAsked = (
  held: Held,
  scope: CollectionScope,
  owned: readonly string[],
): AllKnowledgeAsked => {
  const asked: AllKnowledgeAsked = {
    collections: collectionsOf(scope, owned),
    sort: sortedOf(held.sort),
    page: held.page,
  };
  if (held.type !== "") asked.conceptType = held.type;
  if (held.trust !== undefined) asked.trust = held.trust;
  return asked;
};

export const isNarrowed = (held: Held, scope: CollectionScope): boolean =>
  scope.kind !== "every" || held.type !== "" || held.trust !== undefined;

export const CONCEPT_TYPES_KEYSTROKES = {
  tail: { key: "t", action: "Show types with 2 or fewer concepts, or all types" },
  open: { key: "o", action: "Show or hide the focused type’s collections" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const CONCEPT_TYPES_PAGE = pageById(menuGroupIn(KNOWLEDGE, "curation"), "concept-types");

export const CONCEPT_TYPES_LIST = "types";

export const CONCEPT_TYPES_TAIL_MAX = 2;

const CONCEPT_TYPES_SORTS = ["type", "-type", "count", "-count"] as const;

export type ConceptTypesSort = (typeof CONCEPT_TYPES_SORTS)[number];

const CONCEPT_TYPES_TAILS = ["small"] as const;

export const CONCEPT_TYPES_FIELDS = {
  sort: z.enum(CONCEPT_TYPES_SORTS).catch("type"),
  tail: z.enum(CONCEPT_TYPES_TAILS).optional().catch(undefined),
};

type ConceptTypesSorted = { readonly id: string; readonly desc: boolean };

export const conceptTypesSortedOf = (sort: ConceptTypesSort): ConceptTypesSorted => ({
  id: sort.replace(/^-/u, ""),
  desc: sort.startsWith("-"),
});

export const conceptTypesSortOf = (sorted: ConceptTypesSorted): ConceptTypesSort | undefined =>
  CONCEPT_TYPES_SORTS.find((sort) => sort === `${sorted.desc ? "-" : ""}${sorted.id}`);

export const EXPORTS_KEYSTROKES = {
  knowledgeBase: { key: "k", action: "Download the knowledge base snapshot" },
  records: { key: "r", action: "Download the records" },
  guide: { key: "g", action: "Download the guide snapshot" },
} as const satisfies Readonly<Record<string, Keystroke>>;
