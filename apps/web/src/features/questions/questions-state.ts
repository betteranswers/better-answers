import type { Keystroke } from "@/shared/keystrokes.tsx";

export const QUESTIONS_KEYSTROKES = {
  open: { key: "o", action: "Open the selected question" },
  more: { key: "m", action: "Show more questions" },
} as const satisfies Readonly<Record<string, Keystroke>>;
