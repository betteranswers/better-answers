import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { dayWords, instantWords, PRODUCT_NAME } from "@/shared/words.ts";

export const ACCOUNT_HEADING = "Account";

export const ACCOUNT_WORDS = {
  signIn: "Sign-in",
  goOn: `Go to ${PRODUCT_NAME}`,
  tryAgain: "Try again",
  readingAgain: "Loading",
} as const;

export const THEME_WORDS = {
  heading: "Theme",
  device: "System",
  light: "Light",
  dark: "Dark",
  kept: "Saved in this browser.",
} as const;

const SET_UP = "Set up an authenticator";

const ADD_A_PASSKEY = "Add a passkey";

export const ACCOUNT_ACTIONS = {
  readAgain: "Reload your sign-in methods",
  addPasskey: ADD_A_PASSKEY,
  setUp: SET_UP,
  copyKey: "Copy the key",
  copyCodes: "Copy the codes",
  download: "Download the codes",
  print: "Print the codes",
} as const;

export const PASSKEY_WORDS = {
  heading: "Passkeys",
  none: "No passkeys yet. Add a passkey to sign in without email.",
  noWebAuthn: "This browser can’t add a passkey. Use another browser or device.",
  add: ADD_A_PASSKEY,
  nameField: "Passkey name",
  addCommit: "Add passkey",
  waiting: "Waiting for your device…",
  notAdded: "No passkey was added. Try again.",
  unnamed: "Passkey",
  notUsed: "Not used yet",
  rename: "Rename",
  save: "Save",
  saving: "Saving",
  cancel: "Cancel",
  remove: "Remove",
  removeConsequence: "This permanently removes the passkey from every device.",
  removeCommit: "Remove",
  offer: "Sign in with your fingerprint, face or device PIN instead of email.",
  dismissOffer: "Dismiss passkey offer",
} as const;

export const passkeyDates = (createdAt: string, lastUsedAt: string | null): string =>
  `Added ${dayWords(createdAt)} · ${
    lastUsedAt === null ? PASSKEY_WORDS.notUsed : `Last used ${instantWords(lastUsedAt)}`
  }`;

export const removePasskeyTitle = (name: string): string => `Remove passkey “${name}”`;

/** In the order a user agent is read: Edge names Chrome, and Chrome names Safari. */
const BROWSERS = [
  { pattern: /Edg\//u, browser: "Edge" },
  { pattern: /Firefox\//u, browser: "Firefox" },
  { pattern: /Chrome\//u, browser: "Chrome" },
  { pattern: /Safari\//u, browser: "Safari" },
] as const;

/** An iPhone names Mac OS X and Android names Linux, so each is read first. */
const SYSTEMS = [
  { pattern: /iPhone|iPad/u, system: "iOS" },
  { pattern: /Android/u, system: "Android" },
  { pattern: /Mac OS X|Macintosh/u, system: "macOS" },
  { pattern: /Windows/u, system: "Windows" },
  { pattern: /CrOS/u, system: "ChromeOS" },
  { pattern: /Linux/u, system: "Linux" },
] as const;

export const passkeyNameFor = (userAgent: string): string => {
  const browser = BROWSERS.find((entry) => entry.pattern.test(userAgent))?.browser;
  const system = SYSTEMS.find((entry) => entry.pattern.test(userAgent))?.system;
  if (browser === undefined || system === undefined) return PASSKEY_WORDS.unnamed;
  return `${browser} on ${system}`;
};

export const AUTHENTICATOR_WORDS = {
  heading: "Authenticator",
  none: "You haven’t set up an authenticator app.",
  setUp: SET_UP,
  held: "Your authenticator app is set up.",
  remove: "Remove",
  making: "Preparing your QR code…",
  scan: "Scan this QR code with your authenticator app.",
  qrCode: "QR code for your authenticator app",
  orEnterKey: "Or enter this setup key:",
  copyKey: "Copy key",
  keyCopied: "Key copied.",
  codeField: "Authenticator code",
  codeHint:
    "Enter the 6-digit code from your authenticator app. If it doesn’t work, set your phone’s date and time to automatic.",
  finish: "Finish setup",
  finishing: "Finishing setup",
  startAgain: "Try again",
  removeTitle: "Remove authenticator",
  removeConsequence: "This permanently removes your authenticator.",
  removeCommit: "Remove",
} as const;

export const RECOVERY_CODE_WORDS = {
  heading: "Recovery codes",
  none: "No recovery codes yet.",
  make: "Generate recovery codes",
  replace: "Replace recovery codes",
  making: "Generating codes",
  makingLine: "Generating your recovery codes…",
  replaceTitle: "Replace recovery codes",
  replaceConsequence: "Your current codes stop working at once.",
  replaceCommit: "Replace",
  saveHeading: "Save your recovery codes",
  saveLine:
    "Each code signs you in once if you lose your passkey or authenticator app. You won’t see these codes again.",
  replacedLine: "Your previous codes no longer work.",
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
  `${String(unused)} of ${String(RECOVERY_CODES_IN_A_SET)} codes left · Generated ${dayWords(madeAt)}`;

const noticeTo = (address: string): string => `A confirmation email is on its way to ${address}.`;

export const ACTION_LANDED = {
  passkeyAdded: (name: string, address: string) => `Passkey “${name}” added. ${noticeTo(address)}`,
  passkeyRenamed: (name: string) => `Passkey renamed to “${name}”.`,
  passkeyRemoved: (name: string, address: string) =>
    `Passkey “${name}” removed. ${noticeTo(address)}`,
  setUp: (address: string) => `Authenticator set up. ${noticeTo(address)}`,
  removed: (address: string) => `Authenticator removed. ${noticeTo(address)}`,
  made: (address: string) => `Recovery codes generated. ${noticeTo(address)}`,
  replaced: (address: string) => `Recovery codes replaced. ${noticeTo(address)}`,
} as const;

export const RECOVERY_CODES_FILE = `${PRODUCT_NAME}-recovery-codes.txt`;

export const recoveryCodesText = (
  codes: readonly string[],
  address: string,
  madeAt: string,
): string =>
  [
    `${PRODUCT_NAME} recovery codes for ${address}`,
    `Generated ${dayWords(madeAt)}`,
    "",
    ...codes,
    "",
    "You can use each code once to sign in.",
    "",
  ].join("\n");
