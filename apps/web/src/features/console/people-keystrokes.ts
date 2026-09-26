import type { Keystroke } from "@/shared/keystrokes.tsx";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", act: "Search everyone by name or address" },
  open: { key: "o", act: "Open the person in focus" },
  revoke: { key: "r", act: "Revoke the credentials of the person in focus" },
  correct: { key: "c", act: "Correct the display name of the person in focus" },
  previous: { key: "p", act: "Show the previous page of people" },
  next: { key: "n", act: "Show the next page of people" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const NAMES_WAITING_KEYSTROKES = {
  correct: { key: "c", act: "Correct the display name in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;
