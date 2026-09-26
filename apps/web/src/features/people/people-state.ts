import type { Keystroke } from "@/shared/keystrokes.tsx";
import { viewStateOf } from "@/shared/view-toolbar.tsx";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", act: "Search the members by name or address" },
  open: { key: "o", act: "Open the member in focus" },
  changeRole: { key: "c", act: "Change the role of the member in focus" },
  revokeCredentials: { key: "v", act: "Revoke the credentials here of the member in focus" },
  changeGroups: { key: "g", act: "Change the groups of the member in focus" },
  remove: { key: "d", act: "Remove the member in focus" },
  flagName: { key: "f", act: "Flag the display name of the member in focus" },
  invite: { key: "i", act: "Invite a person by email address" },
  resend: { key: "r", act: "Resend the invitation in focus" },
  cancel: { key: "x", act: "Cancel the invitation in focus" },
  approve: { key: "a", act: "Approve the request in focus" },
  decline: { key: "d", act: "Decline the request in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

/** When the panel last asked the toolbar's invite act to open, so an empty list can offer it. */
export const useInviteAsked = viewStateOf<number>("people.invite");

export const GROUPS_KEYSTROKES = {
  create: { key: "n", act: "Create a group" },
  open: { key: "o", act: "Open the group in focus" },
  changeMembers: { key: "m", act: "Change the members of the group in focus" },
  rename: { key: "r", act: "Rename the group in focus" },
  delete: { key: "d", act: "Delete the group in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;
