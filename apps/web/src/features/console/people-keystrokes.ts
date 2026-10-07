import type { Keystroke } from "@/shared/keystrokes.tsx";
import { selectFirst } from "@/shared/outcome.tsx";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", action: "Search everyone by name or address" },
  open: { key: "o", action: "Open the person in focus" },
  revoke: { key: "r", action: "End every sign-in and token of the person in focus" },
  correct: { key: "c", action: "Correct the display name of the person in focus" },
  previous: { key: "p", action: "Show the previous page of people" },
  next: { key: "n", action: "Show the next page of people" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const NO_PERSON_IN_FOCUS = selectFirst("person");

export const NAMES_WAITING_KEYSTROKES = {
  correct: { key: "c", action: "Correct the display name in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const NO_NAME_IN_FOCUS = selectFirst("name");
