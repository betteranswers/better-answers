import { aRole, ROLE_FOR_A_NEWCOMER } from "@/shared/role-words.ts";
import type { Role } from "@/shared/screens.ts";

export const invitedAs = (inviter: string, role: Role): string =>
  `${inviter} invited you as ${aRole(role)}.`;

/** Apart from the screen's JSX, so the browser suite reads the words the invitation screen shows. */
export const INVITATION_WORDS = {
  untitled: "Your invitation",
  reading: "Reading the invitation.",
  heading: (workspace: string) => `Your invitation to ${workspace}`,
  body: (inviter: string, role: Role) => `${invitedAs(inviter, role)} ${ROLE_FOR_A_NEWCOMER[role]}`,
  join: (workspace: string) => `Join ${workspace}`,
  joining: "Joining",
  tryAgain: "Try again",
  readingAgain: "Reading",
} as const;

/** Each keystroke's act, as the list of keystrokes names it; a way on's act names its button too. */
export const INVITATION_ACTS = {
  join: "Join the workspace",
  readAgain: "Read the invitation again",
  anotherAddress: "Sign in with another address",
  yourWorkspaces: "Go to your workspaces",
} as const;
