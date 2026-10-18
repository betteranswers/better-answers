import { dayWords, PRODUCT_NAME } from "@/shared/words.ts";

export const CODE_AGAIN = "You can enter a code again.";

export const USE_CODE = "Use Code";

export const CONFIRM_WORDS = {
  heading: "Confirm It’s You",
  whyAnAdmin: "As an Admin, confirm with your second factor to continue.",
  whyTheOperator: `As ${PRODUCT_NAME} support, confirm with your second factor to continue.`,
  why: "Confirm with your second factor to continue.",
  passkey: "Use Your Passkey",
  passkeyWaiting: "Waiting for your passkey.",
  passkeyNotUsed: "No passkey was used. Please try again, or use another way below.",
  codeField: "Authenticator Code",
  codeHint: "Authenticator code must be 6 digits.",
  confirm: "Confirm",
  toTheCode: "Go to the Authenticator Code",
  recoveryCode: "Use a Recovery Code",
} as const;

export const PROMOTION_WORDS = {
  lead: "You’re now an Admin. You can confirm your sign-in with:",
  authenticator: "Authenticator",
  after: `If you don’t recognise one, confirm with one you do, then remove it from your Account page. If you don’t recognise any, sign out and contact ${PRODUCT_NAME} support.`,
} as const;

export const passkeyThatConfirms = (name: string | null, createdAt: string): string =>
  ["Passkey", ...(name === null ? [] : [name]), `added ${dayWords(createdAt)}`].join(" · ");

export const UNSAVED_AFTER_CONFIRMING =
  "Confirmed. Your last change wasn't saved, so please make it again.";

export const RECOVERY_WORDS = {
  heading: "Use a Recovery Code",
  why: "Each code works once. You’ll then set up a new second factor.",
  field: "Recovery Code",
  instead: "Use Your Passkey or Authenticator Instead",
  operator: `No codes left? Contact ${PRODUCT_NAME} support to restore your sign-in.`,
} as const;

export const SETUP_WORDS = {
  heading: "Set Up a Second Factor",
  why: "Admins need a passkey or an authenticator to confirm each sign-in.",
  nowAnAdmin: (workspace: string) => `You’re now an Admin of ${workspace}.`,
  newHeading: "Set Up a New Second Factor",
  newWhy: "Finishing replaces your old passkeys, authenticator and recovery codes.",
  restoreField: "Restore Code",
  restoreAccepted: "Your restore code has been accepted successfully.",
  passkey: "Sign in with your fingerprint, face or device PIN.",
  addPasskey: "Add a Passkey",
  authenticatorInstead: "Set Up an Authenticator Instead",
} as const;
