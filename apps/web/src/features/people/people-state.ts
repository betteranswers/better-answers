import type { Keystroke } from "@/shared/keystrokes.tsx";
import { INVITE_A_PERSON } from "@/shared/navigation.ts";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", action: "Search the members by name or address" },
  open: { key: "o", action: "Open the member in focus" },
  changeRole: { key: "c", action: "Change the role of the member in focus" },
  endEverySignInAndToken: {
    key: "v",
    action: "End every sign-in and token here of the member in focus",
  },
  changeGroups: { key: "g", action: "Change the groups of the member in focus" },
  remove: { key: "d", action: "Remove the member in focus" },
  flagName: { key: "f", action: "Flag the display name of the member in focus" },
  tick: { key: "x", action: "Select or clear the member in focus" },
  changeSelectedRoles: { key: "C", action: "Change the role of the selected members" },
  addSelectedToGroup: { key: "G", action: "Add the selected members to a group" },
  removeSelected: { key: "D", action: "Remove the selected members" },
  clearSelection: { key: "Escape", action: "Clear the selection" },
  previousPage: { key: "[", action: "Show the previous page of members" },
  nextPage: { key: "]", action: "Show the next page of members" },
  invite: { key: "i", action: INVITE_A_PERSON.name },
  searchInvitations: { key: "/", action: "Search the invitations by address" },
  resend: { key: "r", action: "Resend the invitation in focus" },
  cancel: { key: "d", action: "Cancel the invitation in focus" },
  tickInvitation: { key: "x", action: "Select or clear the invitation in focus" },
  resendSelected: { key: "R", action: "Resend the selected invitations" },
  cancelSelected: { key: "D", action: "Cancel the selected invitations" },
  previousInvitations: { key: "[", action: "Show the previous page of invitations" },
  nextInvitations: { key: "]", action: "Show the next page of invitations" },
  approve: { key: "a", action: "Approve the request in focus" },
  decline: { key: "d", action: "Decline the request in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

/** Shifted, so an action on the selection never shares a key with the action on the row in focus. */
export const shortcutOf = (keystroke: Keystroke): string => `Shift+${keystroke.key}`;

/**
 * Members' own letters, so a reader who opened the page by one finds each action under it again, and
 * the Audit log's for older events.
 */
export const MEMBER_PAGE_KEYSTROKES = {
  changeRole: { key: "c", action: "Change this member's role" },
  changeGroups: { key: "g", action: "Change this member's groups" },
  flagName: { key: "f", action: "Flag this member's display name" },
  endEverySignInAndToken: {
    key: "v",
    action: "End every sign-in and token this member holds here",
  },
  remove: { key: "d", action: "Remove this member" },
  olderActivity: { key: "o", action: "Show this member's older activity" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const GROUPS_KEYSTROKES = {
  create: { key: "n", action: "Create a group" },
  open: { key: "o", action: "Open the group in focus" },
  changeMembers: { key: "m", action: "Change the members of the group in focus" },
  rename: { key: "r", action: "Rename the group in focus" },
  delete: { key: "d", action: "Delete the group in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;
