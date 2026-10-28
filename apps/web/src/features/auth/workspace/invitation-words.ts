import { aRole, ROLE_FOR_A_NEWCOMER } from "@/shared/member/role-words.ts";
import type { Role } from "@/shared/navigation.ts";

export const invitedAs = (inviter: string, role: Role): string =>
  `${inviter} invited you as ${aRole(role)}.`;

export const INVITATION_WORDS = {
  untitled: "Your Invitation",
  reading: "Reading the invitation.",
  heading: (workspace: string) => `Your Invitation to ${workspace}`,
  body: (inviter: string, role: Role) => `${invitedAs(inviter, role)} ${ROLE_FOR_A_NEWCOMER[role]}`,
  join: "Join Workspace",
  joining: "Joining",
  tryAgain: "Try Again",
  readingAgain: "Reading",
} as const;

export const INVITATION_ACTIONS = {
  join: "Join the Workspace",
  readAgain: "Read the Invitation Again",
  anotherAddress: "Sign In with Another Address",
  yourWorkspaces: "Go to Your Workspaces",
} as const;
