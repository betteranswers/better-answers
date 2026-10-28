import { aRole } from "@/shared/member/role-words.ts";
import type { Role } from "@/shared/navigation.ts";
import { counted } from "@/shared/words.ts";

import type { Direction } from "./people-api.ts";

export const SELECTED_MEMBERS = "Selected Members";

export const INCLUDES_YOU = "This includes you.";

export const NO_LONGER_LISTED = "A member no longer listed";

export const homeNowSaid = (role: Role): string =>
  `Your role has been changed to ${role} successfully. This is now your home page.`;

export const MEMBERS_LOADING = "The members are still loading.";

export const GROUPS_LOADING = "The groups are still loading.";

export const MEMBER_PAGE_WORDS = {
  sections: "On This Page",
  access: "Access",
  activity: "Activity",
  removeAndEndEverySignIn: "Remove and End Every Sign-In",
  changeRole: "Change Role",
  holdsRole: (name: string, role: Role) =>
    `${name} is ${aRole(role)}. Select another role to change it.`,
  heldUntilChanged: (name: string, role: Role) => `${name} is ${aRole(role)}.`,
  changesTheirRole: (role: Role) => `This will change their role to ${role}.`,
  changesYourRole: (role: Role) => `This will change your own role to ${role}.`,
  roleChanged: (name: string, role: Role) =>
    `${name}’s role has been changed to ${role} successfully.`,
  signInsAndTokens: "Sign-Ins and Personal Tokens",
  signInsAndTokensHere: "Sign-Ins and Personal Tokens Here",
  endEverySignInAndToken: "End Every Sign-In and Token Here",
  endsAtOnce: (name: string) =>
    `This will end every session and token ${name} holds for this workspace. They can sign in again afterwards.`,
  everySignInEnded: (name: string) =>
    `Every sign-in and token ${name} held here has been ended successfully.`,
  loading: "The member is still loading.",
  noSuchMember: "Member not found",
  toMembers: "Go to Members",
  removing: (name: string) => `Removing ${name} from this workspace.`,
  removed: (name: string) => `${name} has been removed from this workspace successfully.`,
} as const;

export const ACTIVITY_WORDS = {
  loading: "The activity is still loading.",
  none: (name: string) => `No activity for ${name} yet`,
  older: "Older Activity",
  direction: {
    by: (name: string) => `Done by ${name}`,
    to: (name: string) => `Done to ${name}`,
    both: (name: string) => `Done by and to ${name}`,
  } satisfies Readonly<Record<Direction, (name: string) => string>>,
} as const;

const members = (count: number): string => counted(count, "member", "members");

const membersTitled = (count: number): string => counted(count, "Member", "Members");

const membersHave = (count: number): string => counted(count, "member has", "members have");

const changedSaid = (changed: number, none: string, done: string): string =>
  changed === 0 ? none : `${membersHave(changed)} been ${done} successfully.`;

const andAlready = (skipped: number, already: string): string =>
  skipped === 0 ? "" : ` ${String(skipped)} ${skipped === 1 ? "was" : "were"} ${already}.`;

export const BULK_WORDS = {
  changeRole: {
    action: "Change Role",
    title: (count: number) => `Change Role for ${membersTitled(count)}`,
    consequence: (role: Role) => `This will change each member’s role to ${role}.`,
    pending: (count: number, role: Role) => `Changing ${members(count)} to ${role}.`,
    done: (changed: number, role: Role, skipped: number) =>
      `${changedSaid(changed, "No members were changed.", `changed to ${role}`)}${andAlready(skipped, `already in the ${role} role`)}`,
  },
  addToGroup: {
    action: "Add to Group",
    title: (count: number) => `Add ${membersTitled(count)} to a Group`,
    consequence: (group: string | undefined) =>
      group === undefined
        ? "Add these members to a group."
        : `This will add each member to ${group}.`,
    choose: "Select a group",
    pending: (count: number, group: string) => `Adding ${members(count)} to ${group}.`,
    done: (changed: number, group: string, skipped: number) =>
      `${changedSaid(changed, "No members were added.", `added to ${group}`)}${andAlready(skipped, "already in it")}`,
  },
  remove: {
    action: "Remove",
    title: (count: number) => `Remove ${membersTitled(count)}`,
    consequence: (count: number) =>
      `Are you sure you want to remove ${count === 1 ? "this member" : "these members"} from the workspace? They will lose access on every session and assistant they hold.`,
    pending: (count: number) => `Removing ${members(count)} from this workspace.`,
    done: (changed: number, skipped: number) =>
      `${changedSaid(changed, "No members were removed.", "removed from this workspace")}${andAlready(skipped, "no longer a member")}`,
  },
  refused: (count: number) => `No changes were made. There was a problem with ${members(count)}:`,
  stillGoing: "The previous action is still in progress. Please try again when it has finished.",
  roleLoading: "Your role in this workspace is still loading. Please try again in a moment.",
  tooMany: (most: number) => `You can select up to ${members(most)} at a time.`,
} as const;
