import type { Keystroke } from "@/shared/keystrokes.tsx";
import { INVITE_A_PERSON } from "@/shared/navigation.ts";

/** Said when a row's keystroke is pressed and no row has held focus, naming the row to pick. */
export const PEOPLE_SELECT_FIRST = {
  member: "Please select a member first.",
  group: "Please select a group first.",
  invitation: "Please select an invitation first.",
  request: "Please select a request first.",
} as const;

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", action: "Search the Members by Name or Address" },
  searchRequests: { key: "/", action: "Search the Requests by Name or Address" },
  open: { key: "o", action: "Open the Member in Focus" },
  changeRole: { key: "c", action: "Change the Role of the Member in Focus" },
  endEverySignInAndToken: {
    key: "v",
    action: "End Every Sign-In and Token Here of the Member in Focus",
  },
  changeGroups: { key: "g", action: "Change the Groups of the Member in Focus" },
  remove: { key: "d", action: "Remove the Member in Focus" },
  flagName: { key: "f", action: "Flag the Display Name of the Member in Focus" },
  tick: { key: "x", action: "Select or Clear the Member in Focus" },
  changeSelectedRoles: { key: "C", action: "Change the Role of the Selected Members" },
  addSelectedToGroup: { key: "G", action: "Add the Selected Members to a Group" },
  removeSelected: { key: "D", action: "Remove the Selected Members" },
  clearSelection: { key: "Escape", action: "Clear the Selection" },
  previousPage: { key: "[", action: "Show the Previous Page of Members" },
  nextPage: { key: "]", action: "Show the Next Page of Members" },
  invite: { key: "i", action: INVITE_A_PERSON.name },
  searchInvitations: { key: "/", action: "Search the Invitations by Address" },
  resend: { key: "r", action: "Resend the Invitation in Focus" },
  cancel: { key: "d", action: "Cancel the Invitation in Focus" },
  tickInvitation: { key: "x", action: "Select or Clear the Invitation in Focus" },
  resendSelected: { key: "R", action: "Resend the Selected Invitations" },
  cancelSelected: { key: "D", action: "Cancel the Selected Invitations" },
  previousInvitations: { key: "[", action: "Show the Previous Page of Invitations" },
  nextInvitations: { key: "]", action: "Show the Next Page of Invitations" },
  approve: { key: "a", action: "Approve the Request in Focus" },
  decline: { key: "d", action: "Decline the Request in Focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

/** Shifted, so an action on the selection never shares a key with the action on the row in focus. */
export const shortcutOf = (keystroke: Keystroke): string => `Shift+${keystroke.key}`;

/**
 * Members' own letters, so a reader who opened the page by one finds each action under it again, and
 * the Audit log's for older events.
 */
export const MEMBER_PAGE_KEYSTROKES = {
  changeRole: { key: "c", action: "Change This Member’s Role" },
  changeGroups: { key: "g", action: "Change This Member’s Groups" },
  flagName: { key: "f", action: "Flag This Member’s Display Name" },
  endEverySignInAndToken: {
    key: "v",
    action: "End Every Sign-In and Token This Member Holds Here",
  },
  remove: { key: "d", action: "Remove This Member" },
  olderActivity: { key: "o", action: "Show This Member’s Older Activity" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const GROUPS_KEYSTROKES = {
  search: { key: "/", action: "Search the Groups by Name" },
  create: { key: "n", action: "Create a Group" },
  open: { key: "o", action: "Open the Group in Focus" },
  changeMembers: { key: "m", action: "Change the Members of the Group in Focus" },
  rename: { key: "r", action: "Rename the Group in Focus" },
  delete: { key: "d", action: "Delete the Group in Focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;
