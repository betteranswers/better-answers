import { z } from "zod";

import type { Keystroke } from "@/shared/keystrokes.tsx";

import type { Family } from "./audit-log-api.ts";

export const AUDIT_LOG_KEYSTROKES = {
  search: { key: "/", action: "Search the Audit Log" },
  older: { key: "o", action: "Show Older Events" },
  export: { key: "e", action: "Export the Events Shown as a File" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const FAMILIES = [
  "people",
  "knowledge",
  "sources",
  "platform",
] as const satisfies readonly Family[];

export const AUDIT_LOG_LIST = "audit";

/** The read refuses a longer search, so neither the box nor an old address may hold one. */
export const SEARCH_MAX = 100;

export const AUDIT_LOG_FIELDS = {
  search: z.string().max(SEARCH_MAX).catch(""),
  family: z.enum(FAMILIES).optional().catch(undefined),
};
