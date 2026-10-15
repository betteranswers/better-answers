import type { Keystroke } from "@/shared/keystrokes.tsx";

export const QUESTIONS_KEYSTROKES = {
  open: { key: "o", action: "Open the Question in Focus" },
  more: { key: "m", action: "Show More Questions" },
} as const satisfies Readonly<Record<string, Keystroke>>;
