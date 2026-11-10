import { aRole, ROLE_FOR_A_NEWCOMER } from "@/shared/member/role-words.ts";
import type { Role } from "@/shared/navigation.ts";

export const invitedAs = (inviter: string, role: Role): string =>
  `${inviter} invited you as ${aRole(role)}.`;

export const INVITATION_WORDS = {
  untitled: "Your invitation",
  reading: "Loading the invitation…",
  heading: (workspace: string) => `Your invitation to ${workspace}`,
  body: (inviter: string, role: Role) => `${invitedAs(inviter, role)} ${ROLE_FOR_A_NEWCOMER[role]}`,
  join: "Join workspace",
  joining: "Joining",
  tryAgain: "Try again",
  readingAgain: "Loading",
} as const;

export const INVITATION_ACTIONS = {
  join: "Join the workspace",
  readAgain: "Reload the invitation",
  anotherAddress: "Sign in with another address",
  yourWorkspaces: "Go to your workspaces",
} as const;
