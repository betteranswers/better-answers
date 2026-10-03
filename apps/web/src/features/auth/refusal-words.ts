import type { Refusal } from "@/shared/api/trpc.ts";
import { saidOfRefusal, type Said, type SaidOfWord } from "@/shared/refusal-words.ts";
import { minutesUntil } from "@/shared/words.ts";

/** Said on the invitation screen, of its read and of joining alike. */
export const SAID_OF_ACCEPTING = {
  "no-such-invitation": {
    why: "There's no invitation at this link.",
    next: "Ask the person who invited you to send a new one.",
  },
  "invitation-expired": {
    why: "This invitation has expired.",
    next: "Ask the person who invited you to send a new one.",
  },
  "invitation-for-another-address": {
    why: "This invitation is for a different email address.",
    next: "Sign in with the address it was sent to.",
  },
  "already-a-member": {
    why: "You are already a member of this workspace.",
    next: "Open it from your workspaces.",
  },
  "no-display-name": {
    why: "You haven't given a display name yet.",
    next: "Type one, then join.",
  },
  malformed: {
    why: "This invitation link isn't valid.",
    next: "Open the link in the email again.",
  },
} satisfies SaidOfWord;

export const INVITATION_UNANSWERED: Said = {
  why: "No response, so the invitation can't be shown.",
  next: "Try again in a moment.",
};

export const INVITATIONS_UNANSWERED: Said = {
  why: "No response, so your invitations can't be shown.",
  next: "Try again in a moment.",
};

export const JOIN_UNANSWERED: Said = {
  why: "No response, so you haven't joined.",
  next: "Try again in a moment.",
};

/** The one refusal asking to join names: every other says the same, so none reveals a workspace. */
export const REASON_REFUSED: Said = {
  why: "The reason needs a character other than a space.",
  next: "Say why you are asking and send it again.",
};

export const ASK_REFUSED: Said = {
  why: "Your request wasn't sent.",
  next: "Reload the page and ask again.",
};

export const ASK_UNANSWERED: Said = {
  why: "No response, so your request wasn't sent.",
  next: "Try again in a moment.",
};

export const askedTooOften = (liftsInSeconds: number): Said => ({
  why: "You have asked to join too often.",
  next: `Ask again in ${minutesUntil(liftsInSeconds)}.`,
});

const tryAgainWhen = (waitSeconds: number | undefined): string =>
  waitSeconds === undefined
    ? "Wait a few minutes, then try again"
    : `Try again in ${minutesUntil(waitSeconds)}`;

const tryAgainAfter = (waitSeconds: number | undefined): string => `${tryAgainWhen(waitSeconds)}.`;

/** A ceiling's refusal names the wait whenever its answer carried one. */
export const tooManyCodesAskedFor = (waitSeconds: number | undefined): Said => ({
  why: "Too many codes have been asked for.",
  next: tryAgainAfter(waitSeconds),
});

export const tooManyCodesTried = (waitSeconds: number | undefined): Said => ({
  why: "Too many codes have been tried.",
  next: tryAgainAfter(waitSeconds),
});

/** Said on the email step and of a new code alike, so its next step fits both. */
export const CODE_NOT_SENT: Said = {
  why: "No code was sent to that address.",
  next: "Check it, or use a different email address.",
};

export const CODE_UNANSWERED: Said = {
  why: "No response, so no code was sent.",
  next: "Try again in a moment.",
};

const CODE_SPENT: Said = {
  why: "That code can't be used any more.",
  next: "Send a new code.",
};

const triesNamed = (left: number): string => (left === 1 ? "1 try" : `${String(left)} tries`);

export const codeWrong = (triesLeft: number): Said =>
  triesLeft === 0
    ? CODE_SPENT
    : {
        why: "That code is wrong.",
        next: `Check it and try again. ${triesNamed(triesLeft)} left.`,
      };

export const SIGN_IN_UNANSWERED: Said = {
  why: "No response, so you aren't signed in.",
  next: "Try again in a moment.",
};

/** The list of what is left stands beside it, so the list is what to do next. */
export const noLongerAMember = (workspace: string): string =>
  `You are no longer a member of ${workspace}.`;

/** A Try again button stands beside it. */
export const WORKSPACES_UNREAD = "Your workspaces couldn't be read.";

/** Said in the band, where opening the switcher again reads the list again. */
export const SWITCHER_UNREAD: Said = {
  why: WORKSPACES_UNREAD,
  next: "Open the workspace menu to read them again.",
};

/** Said in the band, where the switcher lists the workspaces left. */
export const noLongerAMemberOf = (workspace: string): Said => ({
  why: noLongerAMember(workspace),
  next: "Choose another workspace.",
});

export const PICK_REFUSED: Said = {
  why: "That workspace didn't open.",
  next: "Choose it again.",
};

export const SOLE_PICK_REFUSED: Said = {
  why: "Your workspace didn't open.",
  next: "Reload the page to try again.",
};

export const CONNECTION_UNFINISHED: Said = {
  why: "The connection couldn't be finished.",
  next: "Start it again from the app you were connecting.",
};

/** Said wherever a person changes their own second factor or spends a recovery code. */
export const SAID_OF_SECOND_FACTOR = {
  "no-passkey": {
    why: "That passkey is no longer on your account.",
    next: "Reload the page to see your passkeys.",
  },
  "passkey-name-empty": {
    why: "A name needs a character other than a space.",
    next: "Type one and save again.",
  },
  "passkey-name-too-long": {
    why: "That name is longer than 64 characters.",
    next: "Shorten it and save again.",
  },
  "no-authenticator": {
    why: "You have no authenticator set up.",
    next: "Reload the page to see what you hold.",
  },
  "last-second-factor": {
    why: "You must keep one passkey or authenticator.",
    next: "Add another before removing this one.",
  },
  "recovery-code-wrong": {
    why: "That code is wrong or already used.",
    next: "Check it, or try another code.",
  },
  /** The page reads again as it says this, so Replace stands beside it. */
  "recovery-codes-held": {
    why: "You already have recovery codes, made in another tab or window.",
    next: "Replace them if you need new ones.",
  },
  /** Said under the codes shown: only reloading the page puts them away. */
  "changed-meanwhile": {
    why: "These codes were replaced in another tab or window, so they no longer work.",
    next: "Reload the page to see the codes you hold.",
  },
  "restore-code-needed": {
    why: "Your sign-in was restored, so its restore code comes first.",
    next: "Enter the code better-answers support gave you.",
  },
} satisfies SaidOfWord;

export const saidOfASecondFactorRefusal = (refusal: Refusal): Said =>
  saidOfRefusal(SAID_OF_SECOND_FACTOR, refusal.word, refusal.class);

export const SETUP_CODE_WRONG: Said = {
  why: "That code doesn't match.",
  next: "Enter the code your authenticator shows now. If it still fails, check your phone sets its time automatically.",
};

/** Another tab finished the setup, or started a new one with a new key. */
export const NO_SETUP_WAITING: Said = {
  why: "This setup is no longer open.",
  next: "Reload the page to see what is set up.",
};

export const AUTHENTICATOR_HELD: Said = {
  why: "You already have an authenticator set up.",
  next: "Reload the page to see it.",
};

export const SETUP_REFUSED: Said = {
  why: "Your authenticator wasn't set up.",
  next: "Reload the page and try again.",
};

export const KEY_UNANSWERED: Said = {
  why: "No response, so no key was made.",
  next: "Try again in a moment.",
};

export const SETUP_UNANSWERED: Said = {
  why: "No response, so the setup may not have finished.",
  next: "Reload the page to see where it stands.",
};

export const tooManySetupsStarted = (waitSeconds: number | undefined): Said => ({
  why: "Too many setups have been started.",
  next: tryAgainAfter(waitSeconds),
});

export const REMOVAL_UNANSWERED: Said = {
  why: "No response, so your authenticator wasn't removed.",
  next: "Try again in a moment.",
};

export const CODES_UNANSWERED: Said = {
  why: "No response, so no codes were made.",
  next: "Try again in a moment.",
};

export const codesMadeTooOften = (liftsInSeconds: number | undefined): Said => ({
  why: "New codes have been made too often.",
  next: tryAgainAfter(liftsInSeconds),
});

export const CODES_NOT_TICKED: Said = {
  why: "You haven't ticked that you've saved the codes.",
  next: "Save them, then tick the box.",
};

export const KEY_NOT_COPIED: Said = {
  why: "The key wasn't copied.",
  next: "Select it and copy it yourself.",
};

export const PASSKEY_HELD: Said = {
  why: "This device already holds one of your passkeys.",
  next: "Use another device, or remove the old one first.",
};

export const PASSKEY_NOT_VERIFIED: Said = {
  why: "Your device didn't check it was you, so no passkey was added.",
  next: "Use a device with a fingerprint, face or PIN check.",
};

export const PASSKEY_ASK_EXPIRED: Said = {
  why: "Your device took too long to answer, so no passkey was added.",
  next: "Add the passkey again.",
};

export const PASSKEY_NOT_ADDED: Said = {
  why: "Your device's passkey couldn't be added.",
  next: "Try again, or use another device.",
};

/** The device may have made it and the api kept it before the answer was lost. */
export const PASSKEY_ADD_UNANSWERED: Said = {
  why: "No response, so the passkey may not have been added.",
  next: "Reload the page to see your passkeys.",
};

export const tooManyPasskeysAdded = (waitSeconds: number | undefined): Said => ({
  why: "Too many passkeys have been added.",
  next: tryAgainAfter(waitSeconds),
});

export const RENAME_UNANSWERED: Said = {
  why: "No response, so the passkey wasn't renamed.",
  next: "Try again in a moment.",
};

export const PASSKEY_REMOVAL_UNANSWERED: Said = {
  why: "No response, so the passkey wasn't removed.",
  next: "Try again in a moment.",
};

/** A device that never held one of ours, or one removed since. */
export const PASSKEY_UNKNOWN: Said = {
  why: "That passkey no longer signs in to better-answers.",
  next: "Send a sign-in email, then remove the passkey from your device.",
};

export const PASSKEY_SIGN_IN_NOT_VERIFIED: Said = {
  why: "Your device didn't check it was you, so you aren't signed in.",
  next: "Use a device with a fingerprint, face or PIN check, or send a sign-in email.",
};

export const PASSKEY_SIGN_IN_REFUSED: Said = {
  why: "That passkey didn't sign you in.",
  next: "Try again, or send a sign-in email.",
};

export const tooManyPasskeySignIns = (waitSeconds: number | undefined): Said => ({
  why: "Too many passkey sign-ins have been tried from here.",
  next: tryAgainAfter(waitSeconds),
});

export const CODES_NOT_COPIED: Said = {
  why: "The codes weren't copied.",
  next: "Select them and copy them yourself.",
};

/** The other ways a throttled code's screen can name, each only when the person holds it. */
const OTHER_WAYS = {
  passkey: "your passkey",
  authenticator: "your authenticator",
  "recovery-code": "a recovery code",
} as const;

export type OtherWay = keyof typeof OTHER_WAYS;

const orUsing = (others: readonly OtherWay[]): string =>
  others.length === 0 ? "" : `, or use ${others.map((way) => OTHER_WAYS[way]).join(" or ")}`;

/** The field waits, with no countdown, while every other way the person holds stays open. */
export const tooManyCodesTriedOr = (
  waitSeconds: number | undefined,
  others: readonly OtherWay[],
): Said => ({
  why: "Too many codes have been tried.",
  next: `${tryAgainWhen(waitSeconds)}${orUsing(others)}.`,
});

export const AUTHENTICATOR_CODE_WRONG: Said = {
  why: "That code is wrong.",
  next: "Enter the code your authenticator shows now.",
};

export const CONFIRM_UNANSWERED: Said = {
  why: "No response, so nothing was confirmed.",
  next: "Try again in a moment.",
};

export const PASSKEY_NOT_YOURS: Said = {
  why: "That passkey isn't one of yours.",
  next: "Use another passkey, or another way below.",
};

export const PASSKEY_CONFIRM_NOT_VERIFIED: Said = {
  why: "Your device didn't check it was you, so nothing was confirmed.",
  next: "Use a device with a fingerprint, face or PIN check, or another way below.",
};

export const PASSKEY_CONFIRM_EXPIRED: Said = {
  why: "Your device took too long to answer, so nothing was confirmed.",
  next: "Use your passkey again.",
};

export const NO_PASSKEY_TO_CONFIRM: Said = {
  why: "You have no passkey to confirm with.",
  next: "Use another way below.",
};

export const PASSKEY_CONFIRM_REFUSED: Said = {
  why: "Your passkey didn't confirm it's you.",
  next: "Try again, or use another way below.",
};

export const tooManyConfirmations = (waitSeconds: number | undefined): Said => ({
  why: "Too many confirmations have been tried.",
  next: tryAgainAfter(waitSeconds),
});

/** The api may have spent the code before the answer was lost. */
export const RECOVERY_UNANSWERED: Said = {
  why: "No response, so the code may not have been used.",
  next: "Reload the page to see where it stands.",
};

export const RESTORE_CODE_WRONG: Said = {
  why: "That restore code is wrong or has expired.",
  next: "Check it, or ask better-answers support for a new one.",
};

/** Said where a sign-in without the right to set up asks to, before the screen moves on. */
export const SETUP_NOT_GRANTED: Said = {
  why: "This sign-in can't set up a new second factor.",
  next: "Confirm it's you first.",
};

export const RESTORE_CODE_NEEDED: Said = SAID_OF_SECOND_FACTOR["restore-code-needed"];

/** Said to a page that began the first setup before its session was granted a replacing one. */
export const REPLACEMENT_SETUP_NEEDED: Said = {
  why: "This sign-in can only set up a factor that replaces your old ones.",
  next: "Reload the page and start the setup again.",
};

export const FACTORS_CHANGED_MEANWHILE: Said = {
  why: "Your second factors changed in another tab or window, so nothing was replaced.",
  next: "Reload the page to see what you hold.",
};
