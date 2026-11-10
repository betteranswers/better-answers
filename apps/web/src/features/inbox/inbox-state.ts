import { z } from "zod";

import { ULID } from "@better-answers/schema/ulid";

import type { Keystroke } from "@/shared/keystrokes.tsx";
import { INBOX, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

export const WAITING_ON_YOU = pageNamed(menuGroupIn(INBOX, "inbox"), "Waiting on You");

export const SUGGESTION_ID = z.string().regex(ULID);

export const WAITING_KEYSTROKES = {
  open: { key: "o", action: "Open the suggestion in focus" },
  tick: { key: "x", action: "Select or clear the suggestion in focus" },
  acceptSelected: { key: "A", action: "Accept the selected suggestions" },
  clearSelection: { key: "Escape", action: "Clear the selection" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const EDIT_KEYSTROKES = {
  accept: { key: "a", action: "Accept this suggestion" },
  decline: { key: "d", action: "Decline this suggestion" },
  back: { key: "b", action: `Go back to ${WAITING_ON_YOU.name}` },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const shortcutOf = (keystroke: Keystroke): string => `Shift+${keystroke.key}`;

export const RETURNED_TO = z.object({ openedSuggestion: z.string().optional().catch(undefined) });

export const DECIDED_ON_ITS_PAGE = z.object({
  decided: z.object({ suggestionId: z.string(), said: z.string(), refused: z.boolean() }),
});

export type DecidedOnItsPage = z.output<typeof DECIDED_ON_ITS_PAGE>["decided"];
