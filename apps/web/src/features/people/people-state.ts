import type { Keystroke } from "@/shared/keystrokes.tsx";
import { INVITE_A_PERSON } from "@/shared/navigation.ts";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", act: "Search the members by name or address" },
  open: { key: "o", act: "Open the member in focus" },
  changeRole: { key: "c", act: "Change the role of the member in focus" },
  revokeCredentials: { key: "v", act: "Revoke the credentials here of the member in focus" },
  changeGroups: { key: "g", act: "Change the groups of the member in focus" },
  remove: { key: "d", act: "Remove the member in focus" },
  flagName: { key: "f", act: "Flag the display name of the member in focus" },
  tick: { key: "x", act: "Select or clear the member in focus" },
  changeSelectedRoles: { key: "C", act: "Change the role of the selected members" },
  addSelectedToGroup: { key: "G", act: "Add the selected members to a group" },
  removeSelected: { key: "D", act: "Remove the selected members" },
  clearSelection: { key: "Escape", act: "Clear the selection" },
  previousPage: { key: "[", act: "Show the previous page of members" },
  nextPage: { key: "]", act: "Show the next page of members" },
  invite: { key: "i", act: INVITE_A_PERSON.name },
  resend: { key: "r", act: "Resend the invitation in focus" },
  cancel: { key: "x", act: "Cancel the invitation in focus" },
  approve: { key: "a", act: "Approve the request in focus" },
  decline: { key: "d", act: "Decline the request in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

/** Members' own letters, so a reader who opened the page by one finds each act under it again. */
export const MEMBER_PAGE_KEYSTROKES = {
  changeRole: { key: "c", act: "Change this member's role" },
  changeGroups: { key: "g", act: "Change this member's groups" },
  flagName: { key: "f", act: "Flag this member's display name" },
  revokeCredentials: { key: "v", act: "Revoke this member's credentials here" },
  remove: { key: "d", act: "Remove this member" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const GROUPS_KEYSTROKES = {
  create: { key: "n", act: "Create a group" },
  open: { key: "o", act: "Open the group in focus" },
  changeMembers: { key: "m", act: "Change the members of the group in focus" },
  rename: { key: "r", act: "Rename the group in focus" },
  delete: { key: "d", act: "Delete the group in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;
