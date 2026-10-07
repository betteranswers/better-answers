import type { Role } from "@/shared/navigation.ts";
import { counted } from "@/shared/words.ts";

import type { Direction } from "./people-api.ts";

export const SELECTED_MEMBERS = "Selected members";

export const INCLUDES_YOU = "This includes you.";

export const RECORDED = "Recorded on the audit log under your name.";

export const NO_LONGER_LISTED = "A member no longer listed";

export const homeNowSaid = (role: Role): string =>
  `You changed your own role to ${role}. People is for Admins, so this is your home now.`;

export const MEMBERS_LOADING = "The members are still loading.";

export const GROUPS_LOADING = "The groups are still loading.";

export const MEMBER_PAGE_WORDS = {
  sections: "On this page",
  access: "Access",
  activity: "Activity",
  removeAndEndEverySignIn: "Remove and end every sign-in",
  loading: "The member is still loading.",
  noSuchMember: "This page names no member of this workspace.",
  toMembers: "Go to Members",
  removing: (name: string) => `Removing ${name} from this workspace.`,
  removed: (name: string) => `${name} is no longer a member of this workspace.`,
} as const;

export const ACTIVITY_WORDS = {
  loading: "The activity is still loading.",
  none: (name: string) => `No acts by or to ${name} in this workspace yet.`,
  older: "Older activity",
  direction: {
    by: (name: string) => `By ${name}`,
    to: (name: string) => `To ${name}`,
    both: (name: string) => `By and to ${name}`,
  } satisfies Readonly<Record<Direction, (name: string) => string>>,
} as const;

const members = (count: number): string => counted(count, "member", "members");

/** A row whose change was already true is counted, never refused. */
const andAlready = (skipped: number, already: string): string =>
  skipped === 0 ? "." : `; ${String(skipped)} ${skipped === 1 ? "was" : "were"} ${already}.`;

export const BULK_WORDS = {
  changeRole: {
    act: "Change role",
    title: (count: number) => `Change the role of ${members(count)}`,
    consequence: `Each holds the new role from their next request. ${RECORDED}`,
    commit: (count: number, role: Role) => `Change ${members(count)} to ${role}`,
    pending: (count: number, role: Role) => `Changing ${members(count)} to ${role}.`,
    done: (changed: number, role: Role, skipped: number) =>
      `Changed ${members(changed)} to ${role}${andAlready(skipped, `already in the ${role} role`)}`,
  },
  addToGroup: {
    act: "Add to group",
    title: (count: number) => `Add ${members(count)} to a group`,
    consequence: `Anyone already in the group stays in it. ${RECORDED}`,
    choose: "Choose a group",
    commit: (count: number, group: string) => `Add ${members(count)} to ${group}`,
    pending: (count: number, group: string) => `Adding ${members(count)} to ${group}.`,
    done: (changed: number, group: string, skipped: number) =>
      `Added ${members(changed)} to ${group}${andAlready(skipped, "in it already")}`,
  },
  remove: {
    act: "Remove",
    title: (count: number) => `Remove ${members(count)}`,
    consequence: `They lose access to this workspace on every session and assistant they hold. Any other workspace they belong to is untouched, and they stay named on what they checked. ${RECORDED}`,
    commit: (count: number) => `Remove ${members(count)} from this workspace`,
    pending: (count: number) => `Removing ${members(count)} from this workspace.`,
    done: (changed: number, skipped: number) =>
      `Removed ${members(changed)} from this workspace${andAlready(skipped, "no longer a member")}`,
  },
  refused: (count: number) =>
    `Nothing changed. ${counted(count, "member was", "members were")} refused:`,
  stillGoing: "The act before this one is still going. Try again once it answers.",
  tooMany: (most: number) => `Select at most ${members(most)} for one act.`,
} as const;
