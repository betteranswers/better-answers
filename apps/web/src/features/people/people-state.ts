import type { Keystroke } from "@/shared/keystrokes.tsx";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", act: "Search the members by name or address" },
} as const satisfies Readonly<Record<string, Keystroke>>;
