import type { Keystroke } from "@/shared/keystrokes.tsx";
import { viewStateOf } from "@/shared/view-toolbar.tsx";

export const PEOPLE_KEYSTROKES = {
  search: { key: "/", act: "Search the members by name or address" },
  open: { key: "o", act: "Open the member in focus" },
  changeRole: { key: "c", act: "Change the role of the member in focus" },
  invite: { key: "i", act: "Invite a person by email address" },
  resend: { key: "r", act: "Resend the invitation in focus" },
  cancel: { key: "x", act: "Cancel the invitation in focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

/** When the panel last asked the toolbar's invite act to open, so an empty list can offer it. */
export const useInviteAsked = viewStateOf<number>("people.invite");
