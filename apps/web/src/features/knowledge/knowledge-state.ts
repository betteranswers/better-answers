import { z } from "zod";

import type { Keystroke } from "@/shared/keystrokes.tsx";

export const SEARCH_KEYSTROKES = {
  search: { key: "/", action: "Search This Workspace’s Knowledge" },
  more: { key: "m", action: "Show More Matches" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const CONCEPT_KEYSTROKES = {
  back: { key: "b", action: "Go Back to Search" },
  sources: { key: "s", action: "Go to the Concept’s Sources" },
  links: { key: "l", action: "Go to the Concept’s Links" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const SEARCH_LIST = "knowledge";

/** The read refuses a longer query, so neither the box nor an old address may hold one. */
export const QUERY_MAX = 500;

export const MATCHES_A_PAGE = 20;

export const SEARCH_FIELDS = {
  search: z.string().max(QUERY_MAX).catch(""),
};
