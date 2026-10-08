import type { Role } from "@/shared/navigation.ts";
import { aRole, ROLE_FOR_A_NEWCOMER } from "@/shared/role-words.ts";

export const invitedAs = (inviter: string, role: Role): string =>
  `${inviter} invited you as ${aRole(role)}.`;

/** Apart from the page's JSX, so the browser suite reads the words the invitation page shows. */
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

/** Each keystroke's action, as the list of keystrokes names it; a way on's action names its button too. */
export const INVITATION_ACTIONS = {
  join: "Join the workspace",
  readAgain: "Read the invitation again",
  anotherAddress: "Sign in with another address",
  yourWorkspaces: "Go to your workspaces",
} as const;
