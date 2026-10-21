import { z } from "zod";

import { ULID } from "@better-answers/schema/ulid";

import type { Keystroke } from "@/shared/keystrokes.tsx";

export const ASK_KEYSTROKES = {
  question: { key: "/", action: "Go to the Question" },
  helpful: { key: "h", action: "Mark the Answer as Helpful" },
  flag: { key: "f", action: "Flag the Answer" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const YOUR_QUESTIONS_KEYSTROKES = {
  more: { key: "m", action: "Show More Questions" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const RECORD_ID = z.string().regex(ULID);

export const QUESTION_MAX = 2000;

export const NOTE_MAX = 2000;
