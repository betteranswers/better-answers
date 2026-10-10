import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { dayWords, instantWords, PRODUCT_NAME } from "@/shared/words.ts";

/** The page's heading, and its name in the avatar menu and the links that reach it. */
export const ACCOUNT_HEADING = "Account";

export const ACCOUNT_WORDS = {
  signIn: "Sign-in",
  goOn: `Go to ${PRODUCT_NAME}`,
  tryAgain: "Try again",
  readingAgain: "Reading",
} as const;

export const THEME_WORDS = {
  heading: "Theme",
  device: "Match this device",
  light: "Light",
  dark: "Dark",
  kept: "Kept on this browser.",
} as const;

const SET_UP = "Set up an authenticator";

const ADD_A_PASSKEY = "Add a passkey";

/** What a passkey does, said wherever one is offered. */
const PASSKEY_SIGNS_YOU_IN = "A passkey signs you in with your fingerprint, face or device PIN";

export const ACCOUNT_ACTIONS = {
  readAgain: "Read your sign-in again",
  addPasskey: ADD_A_PASSKEY,
  setUp: SET_UP,
  copyKey: "Copy the key",
  copyCodes: "Copy the codes",
  download: "Download the codes",
  print: "Print the codes",
} as const;

export const PASSKEY_WORDS = {
  heading: "Passkeys",
  none: `No passkeys yet. ${PASSKEY_SIGNS_YOU_IN}, with no email.`,
  noWebAuthn: "This browser can't add a passkey. Use another browser or device.",
  add: ADD_A_PASSKEY,
  nameField: "Name",
  addCommit: "Add passkey",
  waiting: "Waiting for your device",
  notAdded: "No passkey was added.",
  unnamed: "Passkey",
  notUsed: "Not used yet",
  rename: "Rename",
  save: "Save",
  saving: "Saving",
  cancel: "Cancel",
  remove: "Remove",
  removeConsequence: "It stops signing you in at once, on every device that holds it.",
  removeCommit: "Remove passkey",
  offer: "Sign in with your fingerprint, face or device PIN instead of email.",
  dismissOffer: "Dismiss the passkey offer",
} as const;

/** `Added 3 March 2026 · Last used 09:41 · 30 September 2026`, or `· Not used yet`. */
export const passkeyDates = (createdAt: string, lastUsedAt: string | null): string =>
  `Added ${dayWords(createdAt)} · ${
    lastUsedAt === null ? PASSKEY_WORDS.notUsed : `Last used ${instantWords(lastUsedAt)}`
  }`;

export const removePasskeyTitle = (name: string): string => `Remove the passkey "${name}"`;

/** In the order a user agent is read: Edge names Chrome, and Chrome names Safari. */
const BROWSERS = [
  { pattern: /Edg\//, browser: "Edge" },
  { pattern: /Firefox\//, browser: "Firefox" },
  { pattern: /Chrome\//, browser: "Chrome" },
  { pattern: /Safari\//, browser: "Safari" },
] as const;

/** An iPhone names Mac OS X and Android names Linux, so each is read first. */
const SYSTEMS = [
  { pattern: /iPhone|iPad/, system: "iOS" },
  { pattern: /Android/, system: "Android" },
  { pattern: /Mac OS X|Macintosh/, system: "macOS" },
  { pattern: /Windows/, system: "Windows" },
  { pattern: /CrOS/, system: "ChromeOS" },
  { pattern: /Linux/, system: "Linux" },
] as const;

/** `Chrome on macOS`, or `Passkey` for a browser the list doesn't name. */
export const passkeyNameFor = (userAgent: string): string => {
  const browser = BROWSERS.find((entry) => entry.pattern.test(userAgent))?.browser;
  const system = SYSTEMS.find((entry) => entry.pattern.test(userAgent))?.system;
  if (browser === undefined || system === undefined) return PASSKEY_WORDS.unnamed;
  return `${browser} on ${system}`;
};

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
  finish: "Finish setup",
} as const;

export const codesLeft = (unused: number, madeAt: string): string =>
  `${String(unused)} of ${String(RECOVERY_CODES_IN_A_SET)} unused · made ${dayWords(madeAt)}`;

/** The api sends the notice without waiting on it, so the page never says it arrived. */
const noticeTo = (address: string): string => `A notice is on its way to ${address}.`;

/** Said once an action lands, with the notice every change of a second factor sends. */
export const ACTION_LANDED = {
  passkeyAdded: (name: string, address: string) => `Passkey "${name}" added. ${noticeTo(address)}`,
  passkeyRenamed: (name: string) => `Passkey renamed "${name}".`,
  passkeyRemoved: (name: string, address: string) =>
    `Passkey "${name}" removed. ${noticeTo(address)}`,
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
