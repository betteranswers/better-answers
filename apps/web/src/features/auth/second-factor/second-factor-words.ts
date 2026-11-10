import { dayWords, PRODUCT_NAME } from "@/shared/words.ts";

export const CODE_AGAIN = "You can enter a code again.";

export const USE_CODE = "Use code";

export const CONFIRM_WORDS = {
  heading: "Confirm it’s you",
  whyAnAdmin: "As an Admin, confirm with your second factor to continue.",
  whyTheOperator: `As ${PRODUCT_NAME} support, confirm with your second factor to continue.`,
  why: "Confirm with your second factor to continue.",
  passkey: "Use your passkey",
  passkeyWaiting: "Waiting for your passkey…",
  passkeyNotUsed: "No passkey was used. Try again, or use another way below.",
  codeField: "Authenticator code",
  codeHint: "Enter the 6-digit code from your authenticator app.",
  confirm: "Confirm",
  toTheCode: "Go to the authenticator code",
  recoveryCode: "Use a recovery code",
} as const;

export const PROMOTION_WORDS = {
  lead: "You’re now an Admin. You can confirm your sign-in with:",
  authenticator: "Authenticator",
  after: `Confirm with one you recognise, then remove any you don’t from your Account page. If you recognise none, sign out and contact ${PRODUCT_NAME} support.`,
} as const;

export const passkeyThatConfirms = (name: string | null, createdAt: string): string =>
  ["Passkey", ...(name === null ? [] : [name]), `added ${dayWords(createdAt)}`].join(" · ");

export const UNSAVED_AFTER_CONFIRMING = "Confirmed. Save your last change again.";

export const RECOVERY_WORDS = {
  heading: "Use a recovery code",
  why: "Each code works once. After you sign in, you set up a new second factor.",
  field: "Recovery code",
  instead: "Use your passkey or authenticator instead",
  operator: `No codes left? Contact ${PRODUCT_NAME} support to restore your sign-in.`,
} as const;

export const SETUP_WORDS = {
  heading: "Set up a second factor",
  why: "Admins need a passkey or an authenticator app to confirm each sign-in.",
  nowAnAdmin: (workspace: string) => `You’re now an Admin of ${workspace}.`,
  newHeading: "Set up a new second factor",
  newWhy: "When you finish, your old passkeys, authenticator app and recovery codes stop working.",
  restoreField: "Restore code",
  restoreAccepted: "Restore code accepted.",
  passkey: "Sign in with your fingerprint, face or device PIN.",
  addPasskey: "Add a passkey",
  authenticatorInstead: "Set up an authenticator instead",
} as const;
