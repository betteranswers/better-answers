import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { dayWords, instantWords, PRODUCT_NAME } from "@/shared/words.ts";

export const ACCOUNT_HEADING = "Account";

export const ACCOUNT_WORDS = {
  signIn: "Sign-In",
  goOn: `Go to ${PRODUCT_NAME}`,
  tryAgain: "Try Again",
  readingAgain: "Reading",
} as const;

export const THEME_WORDS = {
  heading: "Theme",
  device: "Match this device",
  light: "Light",
  dark: "Dark",
  kept: "Saved on this browser.",
} as const;

const SET_UP = "Set Up an Authenticator";

const ADD_A_PASSKEY = "Add a Passkey";

export const ACCOUNT_ACTIONS = {
  readAgain: "Read Your Sign-In Again",
  addPasskey: ADD_A_PASSKEY,
  setUp: SET_UP,
  copyKey: "Copy the Key",
  copyCodes: "Copy the Codes",
  download: "Download the Codes",
  print: "Print the Codes",
} as const;

export const PASSKEY_WORDS = {
  heading: "Passkeys",
  none: "No passkeys yet. Add a passkey to sign in without email.",
  noWebAuthn: "This browser can’t add a passkey. Please use another browser or device.",
  add: ADD_A_PASSKEY,
  nameField: "Passkey Name",
  addCommit: "Add Passkey",
  waiting: "Waiting for your device.",
  notAdded: "No passkey was added. Please try again.",
  unnamed: "Passkey",
  notUsed: "Not used yet",
  rename: "Rename",
  save: "Save",
  saving: "Saving",
  cancel: "Cancel",
  remove: "Remove",
  removeConsequence:
    "Are you sure you want to remove this passkey? It will stop working on every device.",
  removeCommit: "Remove",
  offer: "Sign in with your fingerprint, face or device PIN instead of email.",
  dismissOffer: "Dismiss Passkey Offer",
} as const;

export const passkeyDates = (createdAt: string, lastUsedAt: string | null): string =>
  `Added ${dayWords(createdAt)} · ${
    lastUsedAt === null ? PASSKEY_WORDS.notUsed : `Last used ${instantWords(lastUsedAt)}`
  }`;

export const removePasskeyTitle = (name: string): string => `Remove Passkey “${name}”`;

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
  copyKey: "Copy Key",
  keyCopied: "Key copied successfully.",
  codeField: "Authenticator Code",
  codeHint:
    "Authenticator code must be 6 digits. If it doesn’t work, please check that your phone sets its time automatically.",
  finish: "Finish Setup",
  finishing: "Finishing Setup",
  startAgain: "Try Again",
  removeTitle: "Remove Authenticator",
  removeConsequence:
    "Are you sure you want to remove your authenticator? It will stop working immediately.",
  removeCommit: "Remove",
} as const;

export const RECOVERY_CODE_WORDS = {
  heading: "Recovery Codes",
  none: "No recovery codes yet",
  make: "Make Recovery Codes",
  replace: "Replace Recovery Codes",
  making: "Making Codes",
  makingLine: "Making codes.",
  replaceTitle: "Replace Recovery Codes",
  replaceConsequence:
    "Are you sure you want to replace your recovery codes? Your current codes will stop working immediately.",
  replaceCommit: "Replace",
  saveHeading: "Save Your Recovery Codes",
  saveLine:
    "Each code signs you in once if you lose your second factor. They won’t be shown again.",
  replacedLine: "Your previous codes no longer work.",
  list: "Recovery Codes",
  copy: "Copy Codes",
  copied: "Codes copied successfully.",
  download: "Download",
  print: "Print",
  saved: "I have saved these codes",
  done: "Done",
  finish: "Finish Setup",
} as const;

export const codesLeft = (unused: number, madeAt: string): string =>
  `${String(unused)} of ${String(RECOVERY_CODES_IN_A_SET)} unused · made ${dayWords(madeAt)}`;

const noticeTo = (address: string): string => `A confirmation email is on its way to ${address}.`;

export const ACTION_LANDED = {
  passkeyAdded: (name: string, address: string) =>
    `Passkey “${name}” has been added successfully. ${noticeTo(address)}`,
  passkeyRenamed: (name: string) => `Passkey has been renamed to “${name}” successfully.`,
  passkeyRemoved: (name: string, address: string) =>
    `Passkey “${name}” has been removed successfully. ${noticeTo(address)}`,
  setUp: (address: string) =>
    `Your authenticator has been set up successfully. ${noticeTo(address)}`,
  removed: (address: string) =>
    `Your authenticator has been removed successfully. ${noticeTo(address)}`,
  made: (address: string) =>
    `Your recovery codes have been made successfully. ${noticeTo(address)}`,
  replaced: (address: string) =>
    `Your recovery codes have been replaced successfully. ${noticeTo(address)}`,
} as const;

export const RECOVERY_CODES_FILE = `${PRODUCT_NAME}-recovery-codes.txt`;

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
