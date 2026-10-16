import { instantWords } from "@/shared/words.ts";

export const LINK_WORDS = {
  checking: "Checking the link.",
  elsewhereTitle: "Enter This Code Where You Started",
  elsewhere: "You opened this link in a different browser.",
  copy: "Copy Code",
  copied: "Code copied successfully.",
  warning: "Warning",
  neverShare: "Never share this code with anyone.",
  deadTitle: "This Sign-In Link No Longer Works",
  dead: "Each link works once, for 5 minutes.",
  backToSignIn: "Back to Sign-In",
  tryAgain: "Try Again",
  readingAgain: "Checking",
} as const;

export const LINK_ACTIONS = {
  copy: "Copy the Code",
  readAgain: "Check the Link Again",
  backToSignIn: "Go Back to Sign-In",
} as const;

/** Safe to say only because the link is bound to this browser. */
export const signingInAs = (address: string): string => `Signing in as ${address}.`;

export const worksUntil = (until: string): string =>
  `This code works until ${instantWords(until)}.`;

/** Grouped in threes, so the eye holds it while typing it elsewhere. */
export const codeShown = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

/** One digit at a time, so a screen reader says six digits rather than two numbers. */
export const codeSpelled = (code: string): string => code.split("").join(" ");

export const CODE_NOT_COPIED = "Couldn't copy. Please type the code on the page where you started.";

/** Sign in is the one control here, and a second press of a spent link shows the dead page. */
export const SIGN_IN_UNCONFIRMED = "We couldn't confirm that. Please try again.";
