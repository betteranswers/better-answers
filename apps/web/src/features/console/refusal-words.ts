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
  why: "Only the operator may open the console.",
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
    why: "Your sign-in is more than an hour old, and revoking needs one from the last hour.",
    next: "Sign in again, and you come back to this person.",
  },
  [NOT_THE_OPERATOR]: {
    why: "Only the operator may revoke credentials everywhere.",
    next: ONLY_THE_OPERATOR.next,
  },
  "no-such-user": NO_SUCH_PERSON,
} satisfies SaidOfWord;

/** The rule's own words, but for a name the operator types for someone else. */
export const SAID_OF_CORRECTING = {
  ...DISPLAY_NAME_REFUSED,
  "display-name-empty": {
    why: DISPLAY_NAME_REFUSED["display-name-empty"].why,
    next: "Type the name they are to be credited by.",
  },
  [SIGN_IN_TOO_OLD]: {
    why: "Your sign-in is more than an hour old, and correcting a name needs one from the last hour.",
    next: "Sign in again, and you come back here.",
  },
  [NOT_THE_OPERATOR]: {
    why: "Only the operator may correct a display name.",
    next: ONLY_THE_OPERATOR.next,
  },
  "no-such-user": NO_SUCH_PERSON,
} satisfies SaidOfWord;
