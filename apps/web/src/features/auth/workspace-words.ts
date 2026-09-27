import { PRODUCT_NAME } from "@/shared/words.ts";

import { invitedAs } from "./invitation-words.ts";

export const PICKER_WORDS = {
  heading: "Your workspaces",
  lead: "Choose the workspace to open.",
  reading: "Reading your workspaces.",
  opening: "Taking you to your workspace.",
  tryAgain: "Try again",
} as const;

export const NO_WORKSPACE_HEADING = "No workspace yet";

/** Apart from the screen's JSX, so the browser suite reads the words the no-workspace screen shows. */
export const NO_WORKSPACE_WORDS = {
  /** Claude's request lapses within minutes, and joining can take an Admin's day. */
  claudeAfterJoining:
    "Claude can connect once you've joined a workspace. When you're in, connect again from Claude.",
  invitations: "Your invitations",
  invitedAs,
  tryAgain: "Try again",
  readingAgain: "Reading",
} as const;

export const NO_WORKSPACE_ACTS = {
  toInvitations: "Go to your invitations",
  readAgain: "Read your invitations again",
} as const;

/** A connection carried through sign-in that the picker could not hand back. */
export const NOT_CONNECTED = {
  heading: "You're signed in",
  carryOn: `Go to ${PRODUCT_NAME}`,
} as const;
