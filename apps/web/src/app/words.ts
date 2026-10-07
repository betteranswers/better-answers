import { ASK, type Page } from "@/shared/navigation.ts";
import { NO_RESPONSE_TO_A_READ, sentenceOf } from "@/shared/refusal-words.ts";

export const FAILED_PAGE = {
  heading: "This page didn't load",
  said: "Your other pages still work.",
  retry: "Try this page again",
} as const;

export const UNKNOWN_PAGE = {
  heading: "No page at this address",
} as const;

/** The menu beside it is named for the open area, so the rail needs a name apart. */
export const RAIL = "Areas";

/** The narrow layout's sheet holds the rail as well, but the person opened it for the menu. */
export const NAVIGATION_SHEET = "Menu";

/** The band's line of places from the area down, named apart from the rail and the menu. */
export const BREADCRUMB = "Breadcrumb";

/** The switcher's way to the whole list of a person's workspaces. */
export const ALL_WORKSPACES = "All workspaces";

/** Said by the one toggle in the band, which names the state it would move to. */
export const TOGGLE = {
  hide: "Hide the menu",
  show: "Show the menu",
} as const;

/** The band's finder. Never called a search: that is Knowledge's page, and this goes places. */
export const JUMP_TO = {
  name: "Jump to",
  said: "Type to narrow the list, then choose one.",
  list: "Matches",
  groups: { areas: "Areas", pages: "Pages", actions: "Actions", members: "Members" },
  kinds: { page: "a page", member: "a member", action: "an action" },
  membersLoading: "The members are still loading.",
  membersUnread:
    "The members didn't load, so none are listed. Close this and open it again to retry.",
} as const;

export const nothingMatches = (typed: string): string => `Nothing matches “${typed}”.`;

const EITHER = new Intl.ListFormat("en-GB", { type: "disjunction" });

/** Names only the kinds this reader can find, so a Viewer is not promised members. */
export const findWhat = (kinds: readonly string[]): string => `Find ${EITHER.format(kinds)}`;

/** No role is held, so no other page can be offered either. */
export const ROLE_UNREAD = sentenceOf(NO_RESPONSE_TO_A_READ);

/** The index finds the home of a reader whose role is not known yet. */
export const goHome = (home: Page | undefined): string =>
  home === undefined ? "Go to your home page" : `Go to ${home.name}`;

/** A role's home says what that role will do there, not only that it is unbuilt. */
const WHILE_UNBUILT: ReadonlyMap<Page, string> = new Map([
  [ASK.home, "Ask in Claude for now. Your questions and their answers will be listed here."],
]);

export const unbuiltLineOf = (home: Page): string =>
  WHILE_UNBUILT.get(home) ?? "This page is on its way.";
