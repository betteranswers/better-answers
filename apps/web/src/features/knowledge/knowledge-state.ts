import { searchText } from "@/shared/address/list-address.ts";
import type { Keystroke } from "@/shared/keystrokes.tsx";

export const SEARCH_KEYSTROKES = {
  search: { key: "/", action: "Search" },
  open: { key: "o", action: "Open the selected match" },
  close: { key: "Escape", action: "Close the passage" },
  more: { key: "m", action: "Show more matches" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const wayBackKeystroke = (page: string): Keystroke => ({
  key: "b",
  action: `Go back to ${page}`,
});

export const CONCEPT_KEYSTROKES = {
  back: wayBackKeystroke("Search"),
  sources: { key: "s", action: "Go to sources" },
  links: { key: "l", action: "Go to links" },
  copy: { key: "c", action: "Copy the text" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const EDITOR_KEYSTROKES = {
  edit: { key: "e", action: "Edit or suggest an edit" },
  mode: { key: "m", action: "Switch between visual and Markdown" },
  save: { key: "Control+Enter", action: "Save" },
  leave: { key: "Escape", action: "Leave the text field" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const COLLECTIONS_KEYSTROKES = {
  changeOwner: { key: "c", action: "Change the selected collection’s owner" },
  undo: { key: "u", action: "Undo the last owner change" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const KNOWLEDGE_BASE_KEYSTROKES = {
  tree: { key: "t", action: "Go to collections and types" },
  concepts: { key: "c", action: "Go to the concept list" },
  more: { key: "m", action: "Show more concepts" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const SEARCH_LIST = "knowledge";

export const QUERY_MAX = 500;

export const MATCHES_A_PAGE = 20;

const NEW_CONCEPT_MAX = 500;

export const SEARCH_FIELDS = {
  search: searchText(QUERY_MAX),
  new: searchText(NEW_CONCEPT_MAX),
  collection: searchText(NEW_CONCEPT_MAX),
  type: searchText(NEW_CONCEPT_MAX),
  tags: searchText(NEW_CONCEPT_MAX),
  subject: searchText(NEW_CONCEPT_MAX),
};

export const KNOWLEDGE_BASE_LIST = "base";

export const KNOWLEDGE_BASE_FIELDS = {
  collection: searchText(),
  type: searchText(),
};

type HeldOpen = { readonly collection: string; readonly type: string };

export type OpenConceptType =
  | { readonly collection: string | null; readonly conceptType: string }
  | undefined;

const NOTHING_OPEN = "";

const NO_COLLECTION_HELD = "";

export const openConceptTypeAt = (held: HeldOpen): OpenConceptType =>
  held.type.trim() === NOTHING_OPEN
    ? undefined
    : {
        collection: held.collection === NO_COLLECTION_HELD ? null : held.collection,
        conceptType: held.type,
      };

export const heldOf = (collection: string | null, conceptType: string): HeldOpen => ({
  collection: collection ?? NO_COLLECTION_HELD,
  type: conceptType,
});
