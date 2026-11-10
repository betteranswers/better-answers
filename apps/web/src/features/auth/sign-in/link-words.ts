import { instantWords } from "@/shared/words.ts";

export const LINK_WORDS = {
  checking: "Checking your sign-in link…",
  elsewhereTitle: "Enter this code to finish signing in",
  elsewhere:
    "You opened this link in a different browser. Enter this code in the browser where you started signing in.",
  copy: "Copy code",
  copied: "Code copied.",
  warning: "Warning",
  neverShare: "Never share this code with anyone.",
  deadTitle: "This sign-in link no longer works",
  dead: "A sign-in link works once, for 5 minutes. Go back to sign-in to get a new code.",
  backToSignIn: "Back to sign-in",
  tryAgain: "Try again",
  readingAgain: "Checking",
} as const;

export const LINK_ACTIONS = {
  copy: "Copy the code",
  readAgain: "Check the link again",
  backToSignIn: "Go back to sign-in",
} as const;

export const signingInAs = (address: string): string => `This link signs you in as ${address}.`;

export const worksUntil = (until: string): string =>
  `This code works until ${instantWords(until)}.`;

export const codeShown = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

export const codeSpelled = (code: string): string => code.split("").join(" ");

export const CODE_NOT_COPIED =
  "Couldn’t copy the code. Type it in the browser where you started signing in.";

export const SIGN_IN_UNCONFIRMED = "We couldn’t confirm that. Try again.";
