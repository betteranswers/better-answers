import { aRole } from "@/shared/member/role-words.ts";
import type { Role } from "@/shared/navigation.ts";
import { counted } from "@/shared/words.ts";

import type { Direction } from "./people-api.ts";

export const SELECTED_MEMBERS = "Selected members";

export const INCLUDES_YOU = "This includes you.";

export const NO_LONGER_LISTED = "A member no longer listed";

export const homeNowSaid = (role: Role): string =>
  `Your role is now ${role}. This is your home page now.`;

export const MEMBERS_LOADING = "The members are still loading.";

export const GROUPS_LOADING = "The groups are still loading.";

export const MEMBER_PAGE_WORDS = {
  sections: "On this page",
  access: "Access",
  activity: "Activity",
  removeAndSignOut: "Remove and sign out",
  changeRole: "Change role",
  holdsRole: (name: string, role: Role) =>
    `${name} is ${aRole(role)}. Select another role to change it.`,
  heldUntilChanged: (name: string, role: Role) => `${name} is ${aRole(role)}.`,
  changesTheirRole: (role: Role) => `This changes their role to ${role}.`,
  changesYourRole: (role: Role) => `This changes your own role to ${role}.`,
  roleChanged: (name: string, role: Role) => `${name} is now ${aRole(role)}.`,
  lastSignedOut: "Last signed out of this workspace",
  signOutHere: "Sign out of this workspace",
  signOutHint: (name: string) =>
    `This signs ${name} out on every device and ends their assistants’ access.`,
  signOutHintForYou: " You will be signed out too.",
  signedOut: (name: string) =>
    `${name} is signed out of this workspace, and their assistants’ access has ended.`,
  loading: "The member is still loading.",
  noSuchMember: "Member not found",
  toMembers: "Go to Members",
  removing: (name: string) => `Removing ${name} from this workspace.`,
  removed: (name: string) => `${name} removed from this workspace.`,
  removal: "Removal",
  removeMember: "Remove member",
  removeName: (name: string) => `Remove ${name}`,
  removeConfirm: (name: string) =>
    `${name} will lose access to this workspace, along with their assistants.`,
  removeConfirmYou: "You will lose access to this workspace, along with your assistants.",
  keepMember: "Keep member",
  displayName: "Display name",
  flagName: "Flag name",
  flagHint: "Flag an inappropriate name to better-answers support.",
  flagged: "Name flagged to better-answers support.",
} as const;

export const MEMBERS_WORDS = {
  open: "Open",
  anyGroup: "Any group",
  anyRole: "Any role",
  noneMatchFilters: "No members match these filters.",
  noneMatch: (search: string) => `No members match “${search}”.`,
  pages: "Pages of members",
} as const;

export const ACTIVITY_WORDS = {
  loading: "The activity is still loading.",
  none: (name: string) => `No activity for ${name} yet`,
  older: "Older activity",
  direction: {
    by: (name: string) => `Done by ${name}`,
    to: (name: string) => `Done to ${name}`,
    both: (name: string) => `Done by and to ${name}`,
  } satisfies Readonly<Record<Direction, (name: string) => string>>,
} as const;

const members = (count: number): string => counted(count, "member", "members");

const changedSaid = (changed: number, none: string, done: string): string =>
  changed === 0 ? none : `${members(changed)} ${done}.`;

const andAlready = (skipped: number, already: string): string =>
  skipped === 0 ? "" : ` ${String(skipped)} ${skipped === 1 ? "was" : "were"} ${already}.`;

export const BULK_WORDS = {
  changeRole: {
    action: "Change role",
    title: (count: number) => `Change role for ${members(count)}`,
    consequence: (role: Role) => `Each member becomes ${aRole(role)}.`,
    pending: (count: number, role: Role) => `Changing ${members(count)} to ${role}.`,
    done: (changed: number, role: Role, skipped: number) =>
      `${changedSaid(changed, "No members were changed.", `changed to ${role}`)}${andAlready(skipped, `already in the ${role} role`)}`,
  },
  addToGroup: {
    action: "Add to group",
    title: (count: number) => `Add ${members(count)} to a group`,
    consequence: (group: string | undefined) =>
      group === undefined ? "Choose a group." : `Each member joins ${group}.`,
    choose: "Select a group",
    pending: (count: number, group: string) => `Adding ${members(count)} to ${group}.`,
    done: (changed: number, group: string, skipped: number) =>
      `${changedSaid(changed, "No members were added.", `added to ${group}`)}${andAlready(skipped, "already in it")}`,
  },
  remove: {
    action: "Remove",
    title: (count: number) => `Remove ${members(count)}`,
    consequence: (count: number) =>
      `${count === 1 ? "This member" : "These members"} will lose access to this workspace, along with their assistants.`,
    pending: (count: number) => `Removing ${members(count)} from this workspace.`,
    done: (changed: number, skipped: number) =>
      `${changedSaid(changed, "No members were removed.", "removed from this workspace")}${andAlready(skipped, "no longer a member")}`,
  },
  refused: (count: number) => `No changes were made. There was a problem with ${members(count)}:`,
  stillGoing: "Wait for the previous action to finish.",
  roleLoading: "Your role is still loading. Try again in a moment.",
  tooMany: (most: number) => `You can select up to ${members(most)} at a time.`,
} as const;
