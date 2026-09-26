import { PRODUCT_NAME } from "@/shared/words.ts";

export const PICKER_WORDS = {
  heading: "Your workspaces",
  lead: "Choose the workspace to open.",
  reading: "Reading your workspaces.",
  opening: "Taking you to your workspace.",
  tryAgain: "Try again",
} as const;

export const NO_WORKSPACE_HEADING = "No workspace yet";

/** A connection carried through sign-in that the picker could not hand back. */
export const NOT_CONNECTED = {
  heading: "You're signed in",
  carryOn: `Go to ${PRODUCT_NAME}`,
} as const;
