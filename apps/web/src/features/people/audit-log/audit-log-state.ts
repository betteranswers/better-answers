import { z } from "zod";

import { searchText } from "@/shared/address/list-address.ts";
import type { Keystroke } from "@/shared/keystrokes.tsx";

import type { Family } from "./audit-log-api.ts";

export const AUDIT_LOG_KEYSTROKES = {
  search: { key: "/", action: "Search the audit log" },
  older: { key: "o", action: "Show older events" },
  export: { key: "e", action: "Export the events shown as a file" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const FAMILIES = [
  "people",
  "knowledge",
  "sources",
  "platform",
] as const satisfies readonly Family[];

export const AUDIT_LOG_LIST = "audit";

export const SEARCH_MAX = 100;

export const AUDIT_LOG_FIELDS = {
  search: searchText(SEARCH_MAX),
  family: z.enum(FAMILIES).optional().catch(undefined),
};
