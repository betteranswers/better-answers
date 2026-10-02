import type { Said, SaidOfWord } from "@/shared/refusal-words.ts";
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

const tryAgainAfter = (waitSeconds: number | undefined): string =>
  waitSeconds === undefined
    ? "Wait a few minutes, then try again."
    : `Try again in ${minutesUntil(waitSeconds)}.`;

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
} satisfies SaidOfWord;

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

export const CODES_NOT_COPIED: Said = {
  why: "The codes weren't copied.",
  next: "Select them and copy them yourself.",
};
