import { z } from "zod";

import { PAGE_NUMBER, searchText } from "@/shared/address/list-address.ts";
import type { Keystroke } from "@/shared/keystrokes.tsx";

import type { AllKnowledgeAsked } from "../knowledge-api.ts";

export const ALL_KNOWLEDGE_KEYSTROKES = {
  open: { key: "o", action: "Open the Concept in Focus" },
  tick: { key: "x", action: "Select or Clear the Concept in Focus" },
  setOwner: { key: "O", action: "Set the Owner of the Selected Concepts" },
  clearSelection: { key: "Escape", action: "Clear the Selection" },
  previousPage: { key: "[", action: "Show the Previous Page of Concepts" },
  nextPage: { key: "]", action: "Show the Next Page of Concepts" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const ALL_KNOWLEDGE_LIST = "all";

export const MOST_SELECTED = 200;

const SORTS = [
  "title",
  "-title",
  "kind",
  "-kind",
  "collection",
  "-collection",
  "owner",
  "-owner",
  "checked",
  "-checked",
] as const;

type Sort = (typeof SORTS)[number];

type Sorted = AllKnowledgeAsked["sort"];

const SORTED = {
  title: { column: "title", desc: false },
  "-title": { column: "title", desc: true },
  kind: { column: "kind", desc: false },
  "-kind": { column: "kind", desc: true },
  collection: { column: "collection", desc: false },
  "-collection": { column: "collection", desc: true },
  owner: { column: "owner", desc: false },
  "-owner": { column: "owner", desc: true },
  checked: { column: "checked", desc: false },
  "-checked": { column: "checked", desc: true },
} as const satisfies Readonly<Record<Sort, Sorted>>;

export const SORTABLE: ReadonlySet<string> = new Set(
  Object.values(SORTED).map(({ column }) => column),
);

export const ALL_KNOWLEDGE_FIELDS = {
  collection: searchText(),
  kind: searchText(),
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
  if (held.kind !== "") asked.kind = held.kind;
  return asked;
};

export const isNarrowed = (held: Held, scope: CollectionScope): boolean =>
  scope.kind !== "every" || held.kind !== "";

export const KINDS_KEYSTROKES = {
  tail: { key: "t", action: "Switch Between Every Kind and Kinds With Two or Fewer Concepts" },
  open: { key: "o", action: "Open or Close the Collections of the Kind in Focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const KINDS_LIST = "kinds";

export const KINDS_TAIL_MAX = 2;

const KINDS_SORTS = ["kind", "-kind", "count", "-count"] as const;

export type KindsSort = (typeof KINDS_SORTS)[number];

const KINDS_TAILS = ["small"] as const;

export const KINDS_FIELDS = {
  sort: z.enum(KINDS_SORTS).catch("kind"),
  tail: z.enum(KINDS_TAILS).optional().catch(undefined),
};

type KindsSorted = { readonly id: string; readonly desc: boolean };

export const kindsSortedOf = (sort: KindsSort): KindsSorted => ({
  id: sort.replace(/^-/u, ""),
  desc: sort.startsWith("-"),
});

export const kindsSortOf = (sorted: KindsSorted): KindsSort | undefined =>
  KINDS_SORTS.find((sort) => sort === `${sorted.desc ? "-" : ""}${sorted.id}`);

export const EXPORTS_KEYSTROKES = {
  knowledgeBase: { key: "k", action: "Download the Knowledge Base Snapshot" },
  records: { key: "r", action: "Download the Records" },
  guide: { key: "g", action: "Download the Guide Snapshot" },
} as const satisfies Readonly<Record<string, Keystroke>>;
