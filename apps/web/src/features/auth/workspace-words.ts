import { PRODUCT_NAME } from "@/shared/words.ts";

import { invitedAs } from "./invitation-words.ts";

export const PICKER_WORDS = {
  heading: "Your Workspaces",
  lead: "Choose a workspace to open.",
  reading: "Reading your workspaces.",
  opening: "Taking you to your workspace.",
  tryAgain: "Try Again",
} as const;

export const PICKER_ACTIONS = {
  toWorkspaces: "Go to Your Workspaces",
} as const;

export const NO_WORKSPACE_HEADING = "No Workspace Yet";

export const NO_WORKSPACE_WORDS = {
  /** Claude's request lapses within minutes, and joining can take an Admin's day. */
  claudeAfterJoining: "Join a workspace, then connect again from Claude.",
  invitations: "Your Invitations",
  invitedAs,
  tryAgain: "Try Again",
  readingAgain: "Reading",
} as const;

export const NO_WORKSPACE_ACTIONS = {
  toInvitations: "Go to Your Invitations",
  readAgain: "Read Your Invitations Again",
} as const;

export const NOT_CONNECTED = {
  heading: "You’re Signed In",
  carryOn: `Go to ${PRODUCT_NAME}`,
} as const;
