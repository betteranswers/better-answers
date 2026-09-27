import type { Said, SaidOfWord } from "@/shared/refusal-words.ts";

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

/** Rounded up, so the reader never asks again before the ceiling lifts. */
const minutesUntil = (seconds: number): string => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
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

export const CODE_REFUSED: Said = {
  why: "That code is wrong or has expired.",
  next: "Check it, or send a new code.",
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
