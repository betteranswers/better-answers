import type { Keystroke } from "@/shared/keystrokes.tsx";

export const AUDIT_LOG_KEYSTROKES = {
  family: { key: "f", act: "Choose the family of acts to show" },
  older: { key: "o", act: "Show older events" },
} as const satisfies Readonly<Record<string, Keystroke>>;
