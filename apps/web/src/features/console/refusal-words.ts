import type { RefusalWord } from "@/shared/api/trpc.ts";
import { DISPLAY_NAME_REFUSED } from "@/shared/display-name-words.ts";
import type { Said, SaidOfWord } from "@/shared/refusal-words.ts";

/**
 * What every console act answers a person without the mark; their standing read says so without
 * asking one.
 */
export const NOT_THE_OPERATOR = "not-the-operator" satisfies RefusalWord;

export const SIGN_IN_TOO_OLD = "sign-in-too-old" satisfies RefusalWord;

export const ONLY_THE_OPERATOR: Said = {
  why: "Only better-answers support may open the console.",
  next: "Go back to your workspaces.",
};

/** A console read refused for anything but the mark or the session. */
export const READ_REFUSED: Said = {
  why: "This can't be shown to you.",
  next: "Go back to your workspaces.",
};

export const STANDING_UNANSWERED: Said = {
  why: "No response, so the console can't be shown.",
  next: "Try again in a moment.",
};

const NO_SUCH_PERSON: Said = {
  why: "No person on the platform holds this id any more.",
  next: "Read the list again.",
};

export const SAID_OF_A_REVOCATION = {
  [SIGN_IN_TOO_OLD]: {
    why: "Your sign-in is more than an hour old, and ending every sign-in and token needs one from the last hour.",
    next: "Once you have signed in, you come back to this person.",
  },
  [NOT_THE_OPERATOR]: {
    why: "Only better-answers support may end every sign-in and token everywhere.",
    next: ONLY_THE_OPERATOR.next,
  },
  "no-such-user": NO_SUCH_PERSON,
} satisfies SaidOfWord;

/** The rule's own words, but for a name the operator types for someone else. */
export const SAID_OF_CORRECTING = {
  ...DISPLAY_NAME_REFUSED,
  "display-name-empty": {
    why: DISPLAY_NAME_REFUSED["display-name-empty"].why,
    next: "Type the name others are to see them by.",
  },
  [SIGN_IN_TOO_OLD]: {
    why: "Your sign-in is more than an hour old, and correcting a name needs one from the last hour.",
    next: "Once you have signed in, you come back here.",
  },
  [NOT_THE_OPERATOR]: {
    why: "Only better-answers support may correct a display name.",
    next: ONLY_THE_OPERATOR.next,
  },
  "no-such-user": NO_SUCH_PERSON,
} satisfies SaidOfWord;
