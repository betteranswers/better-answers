import type { Keystroke } from "@/shared/keystrokes.tsx";
import { searchText } from "@/shared/list-address.ts";

export const SEARCH_KEYSTROKES = {
  search: { key: "/", action: "Search This Workspace’s Knowledge" },
  open: { key: "o", action: "Open the Match in Focus" },
  close: { key: "Escape", action: "Close the Open Passage" },
  more: { key: "m", action: "Show More Matches" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const CONCEPT_KEYSTROKES = {
  back: { key: "b", action: "Go Back to Search" },
  sources: { key: "s", action: "Go to the Concept’s Sources" },
  links: { key: "l", action: "Go to the Concept’s Links" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const COLLECTIONS_KEYSTROKES = {
  changeOwner: { key: "c", action: "Change the Owner of the Collection in Focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const KNOWLEDGE_BASE_KEYSTROKES = {
  tree: { key: "t", action: "Go to the Collections and Kinds" },
  concepts: { key: "c", action: "Go to the Open Kind’s Concepts" },
  more: { key: "m", action: "Show More Concepts" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const SEARCH_LIST = "knowledge";

export const QUERY_MAX = 500;

export const MATCHES_A_PAGE = 20;

export const SEARCH_FIELDS = {
  search: searchText(QUERY_MAX),
};

export const KNOWLEDGE_BASE_LIST = "base";

export const KNOWLEDGE_BASE_FIELDS = {
  collection: searchText(),
  kind: searchText(),
};

type HeldOpen = { readonly collection: string; readonly kind: string };

export type Opened = { readonly collection: string | null; readonly kind: string } | undefined;

const NOTHING_OPEN = "";

const NO_COLLECTION_HELD = "";

export const openedAt = (held: HeldOpen): Opened =>
  held.kind === NOTHING_OPEN
    ? undefined
    : {
        collection: held.collection === NO_COLLECTION_HELD ? null : held.collection,
        kind: held.kind,
      };

export const heldOf = (collection: string | null, kind: string): HeldOpen => ({
  collection: collection ?? NO_COLLECTION_HELD,
  kind,
});
