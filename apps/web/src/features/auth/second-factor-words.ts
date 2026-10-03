import type { Said } from "@/shared/refusal-words.ts";
import { dayWords, PRODUCT_NAME } from "@/shared/words.ts";

/** Said when a field that waited on a throttle takes codes again. */
export const CODE_AGAIN = "You can enter a code again.";

/** The recovery code's button and the restore code's alike. */
export const USE_CODE = "Use code";

export const CONFIRM_WORDS = {
  heading: "Confirm it's you",
  whyAnAdmin: "As an Admin, you confirm a second factor before going on.",
  whyTheOperator: `As ${PRODUCT_NAME} support, you confirm a second factor before going on.`,
  why: "You confirm a second factor before going on.",
  passkey: "Use your passkey",
  passkeyWaiting: "Waiting for your passkey",
  passkeyNotUsed: "No passkey was used. Try again, or use another way below.",
  codeField: "Authenticator code",
  codeHint: "The six digits your authenticator shows now.",
  confirm: "Confirm",
  toTheCode: "Go to the authenticator code",
  recoveryCode: "Use a recovery code",
} as const;

/** Shown to a person just made an Admin, until they first confirm, so a planted factor is seen. */
export const PROMOTION_WORDS = {
  lead: "You've just been made an Admin. These can confirm your sign-in:",
  authenticator: "Authenticator",
  after: `If one isn't yours, confirm with one that is, then remove it on your Account page. If none is, sign out and ask ${PRODUCT_NAME} support to restore your sign-in.`,
} as const;

/** `Passkey · MacBook · added 3 March 2026`; an unnamed one is the passkey added that day. */
export const passkeyThatConfirms = (name: string | null, createdAt: string): string =>
  ["Passkey", ...(name === null ? [] : [name]), `added ${dayWords(createdAt)}`].join(" · ");

/** Said in the band on the page a refused change came from, once the person has confirmed. */
export const UNSAVED_AFTER_CONFIRMING: Said = {
  why: "You've confirmed. Your last change wasn't saved.",
  next: "Make it again.",
};

export const RECOVERY_WORDS = {
  heading: "Use a recovery code",
  why: "Each code works once. Using one lets you set up a new second factor.",
  field: "Recovery code",
  instead: "Use your passkey or authenticator instead",
  operator: `No codes left? Ask ${PRODUCT_NAME} support to restore your sign-in. They check who you are another way first.`,
} as const;

export const SETUP_WORDS = {
  heading: "Set up a second factor",
  why: "Admins must hold a passkey or an authenticator, and confirm with it at sign-in.",
  nowAnAdmin: (workspace: string) => `You're now an Admin of ${workspace}.`,
  newHeading: "Set up a new second factor",
  newWhy:
    "Your recovery code worked. When you finish, your old passkeys and authenticator stop working and you get new recovery codes.",
  restoreField: "Restore code",
  restoreAccepted: "Your restore code worked.",
  passkey: "Signs you in with your fingerprint, face or device PIN, with no email.",
  addPasskey: "Add a passkey",
  authenticatorInstead: "Set up an authenticator instead",
} as const;
