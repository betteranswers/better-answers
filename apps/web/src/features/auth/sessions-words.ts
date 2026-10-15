import type { Refusal } from "@/shared/api/trpc.ts";
import { refusalSentence, type OwnSentences } from "@/shared/refusal-words.ts";
import { counted, instantWords } from "@/shared/words.ts";

export const SESSIONS_HEADING_WORD = "Sessions";

/** A session that ended elsewhere leaves the row standing, so the person reads why it refused. */
const SAID_OF_A_SIGN_OUT = {
  "session-gone": "This session has already ended.",
} satisfies OwnSentences;

export const saidOfASignOutRefusal = (refusal: Refusal): string =>
  refusalSentence(SAID_OF_A_SIGN_OUT, refusal.word, refusal.class);

export const SESSIONS_WORDS = {
  heading: SESSIONS_HEADING_WORD,
  thisDevice: "This device",
  activeNow: "Active now",
  signOut: "Sign out",
  signOutEverywhereElse: "Sign Out Everywhere Else",
  onlySession: "This is your only session.",
  standingLine: "Signing out here doesn’t disconnect Claude or end personal tokens.",
  consequence: "Each one ends now. Personal tokens keep working, and Claude stays connected.",
} as const;

/** The line under a session's device: when it was last active. */
export const lastActiveAt = (iso: string): string => `Last active ${instantWords(iso)}`;

/** The button a row carries, named by the device the row shows. */
export const signOutNamed = (device: string): string => `Sign out ${device}`;

export const everywhereTitle = (others: number): string =>
  `Sign out of ${counted(others, "other session", "other sessions")}`;

export const everywhereCommit = (others: number): string =>
  `Sign out ${counted(others, "session", "sessions")}`;

export const signedOut = (device: string): string => `Signed out ${device}.`;

export const signedOutOthers = (ended: number): string =>
  `Signed out ${counted(ended, "session", "sessions")}.`;
