import type { Keystroke } from "@/shared/keystrokes.tsx";

export const ASK_KEYSTROKES = {
  question: { key: "/", action: "Go to the Question" },
  helpful: { key: "h", action: "Mark the Answer as Helpful" },
  flag: { key: "f", action: "Flag the Answer" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const QUESTION_MAX = 2000;

export const NOTE_MAX = 2000;
