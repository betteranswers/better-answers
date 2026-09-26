import type { Said, SaidOfWord } from "@/shared/refusal-words.ts";

/** Said on the invitation screen, of its read and of joining alike. */
export const SAID_OF_ACCEPTING = {
  "no-such-invitation": {
    why: "No invitation stands at this link: it was cancelled, replaced by a newer one, or never sent.",
    next: "Ask the Admin who invited you to send a new one.",
  },
  "invitation-expired": {
    why: "This invitation has expired.",
    next: "Ask the Admin who invited you to send it again.",
  },
  "invitation-for-another-address": {
    why: "This invitation was sent to another email address than the one you are signed in with.",
    next: "Sign in with the address it was sent to.",
  },
  "already-a-member": {
    why: "You are already a member of this workspace.",
    next: "Open it from your workspaces.",
  },
  "no-display-name": {
    why: "A workspace credits its members by name, and you have not given one yet.",
    next: "Give a display name, then join.",
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
  why: "Your ask wasn't sent.",
  next: "Reload the page and ask again.",
};

export const ASK_UNANSWERED: Said = {
  why: "No response, so your ask wasn't sent.",
  next: "Try again in a moment.",
};
