import { ASK, type Screen } from "@/shared/navigation.ts";
import { NO_RESPONSE_TO_A_READ, sentenceOf } from "@/shared/refusal-words.ts";

export const FAILED_SCREEN = {
  heading: "This screen didn't load",
  said: "Your other screens still work.",
  retry: "Try this screen again",
} as const;

export const UNKNOWN_SCREEN = {
  heading: "No screen at this address",
} as const;

/** The secondary nav beside it is named for the open surface, so the rail needs a name apart. */
export const RAIL = "Surfaces";

/** The narrow layout's sheet holds the rail and the secondary nav, so it is named for both. */
export const NAVIGATION_SHEET = "Surfaces and screens";

/** Said by the one toggle in the band, which names the state it would move to. */
export const TOGGLE = {
  hide: "Hide the secondary nav",
  show: "Show the secondary nav",
} as const;

/** No role is held, so no other screen can be offered either. */
export const ROLE_UNREAD = sentenceOf(NO_RESPONSE_TO_A_READ);

/** The index finds the home of a reader whose role is not known yet. */
export const goHome = (home: Screen | undefined): string =>
  home === undefined ? "Go to your home screen" : `Go to ${home.name}`;

/** A role's home says what that role will do there, not only that it is unbuilt. */
const WHILE_UNBUILT: ReadonlyMap<Screen, string> = new Map([
  [ASK.home, "Ask in Claude for now. Your questions and their answers will be listed here."],
]);

export const unbuiltLineOf = (home: Screen): string =>
  WHILE_UNBUILT.get(home) ?? "This screen is on its way.";
