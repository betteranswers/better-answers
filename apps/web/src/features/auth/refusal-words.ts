import type { Refusal } from "@/shared/api/trpc.ts";
import { refusalSentence, type OwnSentences } from "@/shared/refusal-words.ts";
import { minutesUntil, PRODUCT_NAME } from "@/shared/words.ts";

const INVITATION_LINK_INVALID =
  "This invitation link isn't valid. Please ask the person who invited you to send a new one.";

/** Said on the invitation page, of its read and of joining alike. */
export const SAID_OF_ACCEPTING = {
  "no-such-invitation": INVITATION_LINK_INVALID,
  "invitation-expired":
    "This invitation has expired. Please ask the person who invited you to send a new one.",
  "invitation-for-another-address":
    "This invitation was sent to a different email address. Please sign in with that address to accept it.",
  "already-a-member": "You're already a member of this workspace.",
  "no-display-name": "Please enter a display name.",
  malformed: INVITATION_LINK_INVALID,
} satisfies OwnSentences;

/** The one refusal asking to join names: every other says the same, so none reveals a workspace. */
export const REASON_REFUSED = "Please enter a reason.";

/** Said on the email step and of a new code alike, so its next step fits both. */
export const CODE_NOT_SENT =
  "We couldn't send a code to that address. Please check it, or use a different email address.";

const CODE_SPENT = "This code has expired. Please request a new one.";

const triesNamed = (left: number): string => (left === 1 ? "1 try" : `${String(left)} tries`);

export const codeWrong = (triesLeft: number): string =>
  triesLeft === 0 ? CODE_SPENT : `Verification code is incorrect. ${triesNamed(triesLeft)} left.`;

/** The list of what is left stands beside it, so the list is what to do next. */
export const noLongerAMember = (workspace: string): string =>
  `You're no longer a member of ${workspace}.`;

/** Said in the band, where the switcher lists the workspaces left. */
export const noLongerAMemberOf = (workspace: string): string =>
  `You're no longer a member of ${workspace}.`;

/** The page picked the one workspace itself, so it shows nothing to press again. */
export const SOLE_PICK_REFUSED = "Something went wrong. Please reload the page.";

export const CONNECTION_UNFINISHED =
  "The connection couldn't be completed. Please start it again from the app you were connecting.";

/** Said wherever a person changes their own second factor or spends a recovery code. */
export const SAID_OF_SECOND_FACTOR = {
  "passkey-name-empty": "Please enter a name.",
  "passkey-name-too-long": "Name must be 64 characters or fewer.",
  "last-second-factor":
    "You need at least one passkey or authenticator. Please add another before removing this one.",
  "recovery-code-wrong": "That code is incorrect or has already been used.",
  /** The page reads again as it says this, so Replace stands beside it. */
  "recovery-codes-held":
    "You already have recovery codes. Please replace them if you need new ones.",
  /** Said under the codes shown: only reloading the page puts them away. */
  "changed-meanwhile":
    "These codes have been replaced and no longer work. Please reload the page to see your current codes.",
  "restore-code-needed": `Please enter the restore code ${PRODUCT_NAME} support gave you first.`,
} satisfies OwnSentences;

export const saidOfASecondFactorRefusal = (refusal: Refusal): string =>
  refusalSentence(SAID_OF_SECOND_FACTOR, refusal.word, refusal.class);

export const CODES_NOT_TICKED = "Please confirm you've saved your codes.";

export const PASSKEY_HELD =
  "This device already has one of your passkeys. Please use another device, or remove the old one first.";

export const PASSKEY_NOT_VERIFIED =
  "Your device couldn't verify it's you. Please use a device with a fingerprint, face or PIN check.";

/** Said of adding a passkey and of confirming with one alike. */
export const PASSKEY_ASK_EXPIRED = "Your device took too long to respond. Please try again.";

/** A device that never held one of ours, or one removed since. */
export const PASSKEY_UNKNOWN =
  "This passkey no longer works here. Please sign in by email, then remove the passkey from your device.";

export const PASSKEY_SIGN_IN_NOT_VERIFIED =
  "Your device couldn't verify it's you. Please try another device, or sign in by email.";

export const PASSKEY_SIGN_IN_REFUSED =
  "That passkey didn't work. Please try again, or sign in by email.";

/** The other ways a throttled code's page can name, each only when the person holds it. */
const OTHER_WAYS = {
  passkey: "your passkey",
  authenticator: "your authenticator",
  "recovery-code": "a recovery code",
} as const;

export type OtherWay = keyof typeof OTHER_WAYS;

const orUsing = (others: readonly OtherWay[]): string =>
  others.length === 0 ? "" : `, or use ${others.map((way) => OTHER_WAYS[way]).join(" or ")}`;

const waitNamed = (waitSeconds: number | undefined): string =>
  waitSeconds === undefined ? "later" : `in ${minutesUntil(waitSeconds)}`;

/** The field waits, with no countdown, while every other way the person holds stays open. */
export const tooManyCodesTriedOr = (
  waitSeconds: number | undefined,
  others: readonly OtherWay[],
): string => `Too many attempts. Please try again ${waitNamed(waitSeconds)}${orUsing(others)}.`;

/** Said where a setup is finished and where a sign-in is confirmed alike. */
export const AUTHENTICATOR_CODE_WRONG =
  "Verification code is incorrect. Please enter the code your authenticator shows now.";

export const PASSKEY_NOT_YOURS =
  "That passkey isn't linked to your account. Please try another way below.";

export const PASSKEY_CONFIRM_NOT_VERIFIED =
  "Your device couldn't verify it's you. Please try another way below.";

export const NO_PASSKEY_TO_CONFIRM = "You don't have a passkey. Please try another way below.";

export const PASSKEY_CONFIRM_REFUSED =
  "That passkey didn't work. Please try again, or use another way below.";

export const RESTORE_CODE_WRONG = `That restore code is incorrect or has expired. Please check it, or ask ${PRODUCT_NAME} support for a new one.`;

/** Said where a sign-in without the right to set up asks to, before the page moves on. */
export const SETUP_NOT_GRANTED = "Please confirm it's you before setting up a new second factor.";

export const RESTORE_CODE_NEEDED = SAID_OF_SECOND_FACTOR["restore-code-needed"];
