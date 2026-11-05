import type { Refusal } from "@/shared/api/trpc.ts";
import { refusalSentence, type OwnSentences } from "@/shared/refusal-words.ts";
import { counted, instantWords } from "@/shared/words.ts";

export const SESSIONS_HEADING_WORD = "Sessions";

const SAID_OF_A_SIGN_OUT = {
  "session-gone": "This session has already ended.",
} satisfies OwnSentences;

export const saidOfASignOutRefusal = (refusal: Refusal): string =>
  refusalSentence(SAID_OF_A_SIGN_OUT, refusal.word, refusal.class);

export const SESSIONS_WORDS = {
  heading: SESSIONS_HEADING_WORD,
  thisDevice: "This device",
  activeNow: "Active now",
  signOutEverywhereElse: "Sign Out Everywhere Else",
  onlySession: "This is your only session.",
  standingLine: "Signing out here doesn’t disconnect Claude or end personal tokens.",
  consequence:
    "These sessions will be signed out now. Personal tokens keep working, and Claude stays connected.",
} as const;

export const lastActiveAt = (iso: string): string => `Last active ${instantWords(iso)}`;

export const signOutNamed = (device: string): string => `Sign Out of ${device}`;

export const everywhereTitle = (others: number): string =>
  `Sign Out of ${counted(others, "Other Session", "Other Sessions")}`;

export const everywhereCommit = (others: number): string =>
  `Sign Out ${counted(others, "Session", "Sessions")}`;

export const signedOut = (device: string): string => `Signed out of ${device}.`;

export const signedOutOthers = (ended: number): string =>
  `Signed out ${counted(ended, "session", "sessions")}.`;
