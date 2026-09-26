import { screenById, type Screen } from "@/shared/screens.ts";

export const FAILED_SCREEN = {
  heading: "This screen didn't load",
  said: "Your other screens still work.",
  retry: "Try this screen again",
} as const;

export const UNKNOWN_SCREEN = {
  heading: "No screen at this address",
} as const;

export const UNBUILT_VIEW = "This view is not built yet.";

/** The index finds the home of a reader whose role is not known yet. */
export const goHome = (home: Screen | undefined): string =>
  home === undefined ? "Go to your home screen" : `Go to ${home.name}`;

/** A role's home says what that role will do there, not only that it is unbuilt. */
const WHILE_UNBUILT: ReadonlyMap<Screen, string> = new Map([
  [
    screenById("questions"),
    "You'll see your workspace's questions and answers here, and can ask yours in Claude now.",
  ],
]);

export const unbuiltLineOf = (screen: Screen): string => WHILE_UNBUILT.get(screen) ?? UNBUILT_VIEW;
