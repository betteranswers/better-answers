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

export const SEARCH_LIST = "knowledge";

export const QUERY_MAX = 500;

export const MATCHES_A_PAGE = 20;

export const SEARCH_FIELDS = {
  search: searchText(QUERY_MAX),
};
