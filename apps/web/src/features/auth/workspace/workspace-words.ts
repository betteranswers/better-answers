import { PRODUCT_NAME } from "@/shared/words.ts";

import { invitedAs } from "./invitation-words.ts";

export const PICKER_WORDS = {
  heading: "Your workspaces",
  lead: "Choose a workspace to open.",
  reading: "Loading your workspaces…",
  opening: "Opening your workspace…",
  tryAgain: "Try again",
} as const;

export const PICKER_ACTIONS = {
  toWorkspaces: "Go to your workspaces",
} as const;

export const NO_WORKSPACE_HEADING = "No workspace yet";

export const NO_WORKSPACE_WORDS = {
  claudeAfterJoining: "Join a workspace, then connect again from Claude.",
  invitations: "Your invitations",
  invitedAs,
  tryAgain: "Try again",
  readingAgain: "Loading",
} as const;

export const NO_WORKSPACE_ACTIONS = {
  toInvitations: "Go to your invitations",
  readAgain: "Reload your invitations",
} as const;

export const NOT_CONNECTED = {
  heading: "You’re signed in",
  carryOn: `Go to ${PRODUCT_NAME}`,
} as const;
