import { z } from "zod";

import type { Keystroke } from "@/shared/keystrokes.tsx";

import type { Family } from "./audit-log-api.ts";

export const AUDIT_LOG_KEYSTROKES = {
  search: { key: "/", act: "Search the audit log" },
  older: { key: "o", act: "Show older events" },
  export: { key: "e", act: "Export the events shown as a file" },
} as const satisfies Readonly<Record<string, Keystroke>>;

/** In the order the filter offers them. */
export const FAMILIES = [
  "people",
  "knowledge",
  "sources",
  "platform",
] as const satisfies readonly Family[];

export const AUDIT_LOG_LIST = "audit";

export const AUDIT_LOG_FIELDS = {
  search: z.string().catch(""),
  family: z.enum(FAMILIES).optional().catch(undefined),
};
