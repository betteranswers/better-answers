import type { Said } from "@/shared/refusal-words.ts";
import { instantWords } from "@/shared/words.ts";

/** Apart from the page's JSX, so the browser suite reads the words the link's page shows. */
export const LINK_WORDS = {
  checking: "Checking the link.",
  elsewhereTitle: "Enter this code where you started",
  elsewhere:
    "This browser didn’t ask to sign in, so it stays signed out. Type this code on the page that asked:",
  copy: "Copy code",
  copied: "Code copied.",
  warning: "Warning",
  neverShare: "Never read this code to anyone, or type it into a page you didn’t open yourself.",
  deadTitle: "This sign-in link no longer works",
  dead: "Each link works once, for five minutes.",
  backToSignIn: "Back to sign-in",
  tryAgain: "Try again",
  readingAgain: "Checking",
} as const;

/** Each keystroke's action, as the list of keystrokes names it. */
export const LINK_ACTIONS = {
  copy: "Copy the code",
  readAgain: "Check the link again",
  backToSignIn: "Go back to sign-in",
} as const;

/** Safe to say only because the link is bound to this browser. */
export const signingInAs = (address: string): string => `Signing in as ${address}.`;

export const worksUntil = (until: string): string => `It works until ${instantWords(until)}.`;

/** Grouped in threes, so the eye holds it while typing it elsewhere. */
export const codeShown = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

/** One digit at a time, so a screen reader says six digits rather than two numbers. */
export const codeSpelled = (code: string): string => code.split("").join(" ");

export const LINK_UNREAD: Said = {
  why: "No response, so the link wasn’t checked.",
  next: "Try again in a moment.",
};

export const CODE_NOT_COPIED: Said = {
  why: "The code wasn’t copied.",
  next: "Type it where you started.",
};
