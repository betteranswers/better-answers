import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { dayWords, PRODUCT_NAME } from "@/shared/words.ts";

/** The page's heading, and its name in the avatar menu and the links that reach it. */
export const ACCOUNT_HEADING = "Account";

export const ACCOUNT_WORDS = {
  signIn: "Sign-in",
  goOn: `Go to ${PRODUCT_NAME}`,
  tryAgain: "Try again",
  readingAgain: "Reading",
} as const;

const SET_UP = "Set up an authenticator";

export const ACCOUNT_ACTS = {
  readAgain: "Read your sign-in again",
  setUp: SET_UP,
  copyKey: "Copy the key",
  copyCodes: "Copy the codes",
  download: "Download the codes",
  print: "Print the codes",
} as const;

export const AUTHENTICATOR_WORDS = {
  heading: "Authenticator",
  none: "No authenticator set up.",
  setUp: SET_UP,
  held: "Authenticator set up.",
  remove: "Remove",
  making: "Making a key.",
  scan: "Scan this QR code with your authenticator.",
  qrCode: "QR code for your authenticator",
  orEnterKey: "Or enter this key:",
  copyKey: "Copy key",
  keyCopied: "Key copied.",
  codeField: "Code from your authenticator",
  finish: "Finish setup",
  finishing: "Finishing setup",
  startAgain: "Make a key again",
  removeTitle: "Remove the authenticator",
  removeConsequence: "It stops confirming your sign-in at once.",
  removeCommit: "Remove authenticator",
} as const;

export const RECOVERY_CODE_WORDS = {
  heading: "Recovery codes",
  none: "You have no recovery codes.",
  make: "Make recovery codes",
  replace: "Replace recovery codes",
  making: "Making codes",
  replaceTitle: "Replace your recovery codes",
  replaceConsequence: "Your current codes stop working at once.",
  replaceCommit: "Make new codes",
  saveHeading: "Save your recovery codes",
  saveLine:
    "If you lose your passkey and authenticator, each code signs you in once. This is the only time they're shown.",
  replacedLine: "These replace the codes shown before, which no longer work.",
  list: "Recovery codes",
  copy: "Copy codes",
  copied: "Codes copied.",
  download: "Download",
  print: "Print",
  saved: "I have saved these codes",
  done: "Done",
} as const;

export const codesLeft = (unused: number, madeAt: string): string =>
  `${String(unused)} of ${String(RECOVERY_CODES_IN_A_SET)} unused · made ${dayWords(madeAt)}`;

/** The api sends the notice without waiting on it, so the page never says it arrived. */
const noticeTo = (address: string): string => `A notice is on its way to ${address}.`;

/** Said once an act lands, with the notice every change of a second factor sends. */
export const ACT_LANDED = {
  setUp: (address: string) => `${AUTHENTICATOR_WORDS.held} ${noticeTo(address)}`,
  removed: (address: string) => `Authenticator removed. ${noticeTo(address)}`,
  made: (address: string) => `Recovery codes made. ${noticeTo(address)}`,
  replaced: (address: string) => `Recovery codes replaced. ${noticeTo(address)}`,
} as const;

export const RECOVERY_CODES_FILE = `${PRODUCT_NAME}-recovery-codes.txt`;

/** What the download holds: whose codes they are and when they were made, then one per line. */
export const recoveryCodesText = (
  codes: readonly string[],
  address: string,
  madeAt: string,
): string =>
  [
    `${PRODUCT_NAME} recovery codes for ${address}`,
    `Made ${dayWords(madeAt)}`,
    "",
    ...codes,
    "",
    "Each code signs you in once.",
    "",
  ].join("\n");
