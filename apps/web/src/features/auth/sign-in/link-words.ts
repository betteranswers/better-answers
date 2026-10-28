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

export const signingInAs = (address: string): string => `Signing in as ${address}.`;

export const worksUntil = (until: string): string =>
  `This code works until ${instantWords(until)}.`;

export const codeShown = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

export const codeSpelled = (code: string): string => code.split("").join(" ");

export const CODE_NOT_COPIED = "Couldn't copy. Please type the code on the page where you started.";

export const SIGN_IN_UNCONFIRMED = "We couldn't confirm that. Please try again.";
