import type { Keystroke } from "@/shared/keystrokes.tsx";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", action: "Search Everyone by Name or Address" },
  open: { key: "o", action: "Open the Person in Focus" },
  revoke: { key: "r", action: "End Every Sign-In and Token of the Person in Focus" },
  correct: { key: "c", action: "Correct the Display Name of the Person in Focus" },
  previous: { key: "p", action: "Show the Previous Page of People" },
  next: { key: "n", action: "Show the Next Page of People" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const SELECT_A_PERSON_FIRST = "Please select a person first.";

export const NAMES_WAITING_KEYSTROKES = {
  search: { key: "/", action: "Search the Names Waiting by Name or Workspace" },
  correct: { key: "c", action: "Correct the Display Name in Focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const SELECT_A_NAME_FIRST = "Please select a name first.";

export const WORKSPACES_KEYSTROKES = {
  search: { key: "/", action: "Search Every Workspace by Name or Short Name" },
} as const satisfies Readonly<Record<string, Keystroke>>;
