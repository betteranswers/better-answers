import { aRole, ROLE_FOR_A_NEWCOMER } from "@/shared/member/role-words.ts";
import type { Role } from "@/shared/navigation.ts";

export const invitedAs = (inviter: string, role: Role): string =>
  `${inviter} invited you as ${aRole(role)}.`;

export const INVITATION_WORDS = {
  untitled: "Your Invitation",
  reading: "Loading the invitation.",
  heading: (workspace: string) => `Your Invitation to ${workspace}`,
  body: (inviter: string, role: Role) => `${invitedAs(inviter, role)} ${ROLE_FOR_A_NEWCOMER[role]}`,
  join: "Join Workspace",
  joining: "Joining",
  tryAgain: "Try Again",
  readingAgain: "Loading",
} as const;

export const INVITATION_ACTIONS = {
  join: "Join the Workspace",
  readAgain: "Reload the Invitation",
  anotherAddress: "Sign In with Another Address",
  yourWorkspaces: "Go to Your Workspaces",
} as const;
