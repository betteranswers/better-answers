import { z } from "zod";

import type { Keystroke } from "@/shared/keystrokes.tsx";

export const SEARCH_KEYSTROKES = {
  search: { key: "/", action: "Search this workspace's knowledge" },
  more: { key: "m", action: "Show more matches" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const CONCEPT_KEYSTROKES = {
  back: { key: "b", action: "Go back to Search" },
  sources: { key: "s", action: "Go to the concept’s sources" },
  links: { key: "l", action: "Go to the concept’s links" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const SEARCH_LIST = "knowledge";

/** The read refuses a longer query, so neither the box nor an old address may hold one. */
export const QUERY_MAX = 500;

/** The most the read gives a page. */
export const MATCHES_A_PAGE = 20;

export const SEARCH_FIELDS = {
  search: z.string().max(QUERY_MAX).catch(""),
};
