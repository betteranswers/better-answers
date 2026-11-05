import type { Keystroke } from "@/shared/keystrokes.tsx";

export const ALL_KNOWLEDGE_KEYSTROKES = {} as const satisfies Readonly<Record<string, Keystroke>>;

export const KINDS_KEYSTROKES = {} as const satisfies Readonly<Record<string, Keystroke>>;

export const EXPORTS_KEYSTROKES = {} as const satisfies Readonly<Record<string, Keystroke>>;
