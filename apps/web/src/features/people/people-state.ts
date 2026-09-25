import type { Keystroke } from "@/shared/keystrokes.tsx";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", act: "Search the members by name or address" },
  open: { key: "o", act: "Open the member in focus" },
  changeRole: { key: "c", act: "Change the role of the member in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;
