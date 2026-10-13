import { ASK, type Page } from "@/shared/navigation.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

export const FAILED_PAGE = {
  heading: "This Page Didn’t Load",
  said: "Other pages still work. Please try again.",
  retry: "Try Again",
} as const;

export const UNKNOWN_PAGE = {
  heading: "Page Not Found",
  signIn: "Sign In",
} as const;

/** The menu beside it is named for the open area, so the rail needs a name apart. */
export const RAIL = "Areas";

/** The narrow layout's sheet holds the rail as well, but the person opened it for the menu. */
export const NAVIGATION_SHEET = "Menu";

/** The band's line of places from the area down, named apart from the rail and the menu. */
export const BREADCRUMB = "Breadcrumb";

/** The switcher's way to the whole list of a person's workspaces. */
export const ALL_WORKSPACES = "All Workspaces";

/** Said of a switch this tab only read of: nothing was refused, so nothing is left to redo. */
export const switchedInAnotherTab = (workspace: string): string =>
  `You switched to ${workspace} in another browser tab.`;

/** Said by the one toggle in the band, which names the state it would move to. */
export const TOGGLE = {
  hide: "Hide Menu",
  show: "Show Menu",
} as const;

/** The band's finder. Never called a search: that is Knowledge's page, and this goes places. */
export const JUMP_TO = {
  name: "Jump To",
  said: "Type to filter the list, then choose an item.",
  list: "Matches",
  groups: { areas: "Areas", pages: "Pages", actions: "Actions", members: "Members" },
  kinds: { page: "a page", member: "a member", action: "an action" },
  membersLoading: "The members are still loading.",
  membersUnread: "The members didn’t load. Please close this and open it again.",
} as const;

export const nothingMatches = (typed: string): string => `No results found for “${typed}”.`;

/** The one row that leaves the list: it takes what is typed to Knowledge's Search. */
export const searchFor = (typed: string): string => `Search for “${typed}”`;

const EITHER = new Intl.ListFormat("en-GB", { type: "disjunction" });

/** Names only the kinds this reader can find, so a Viewer is not promised members. */
export const findWhat = (kinds: readonly string[]): string => `Find ${EITHER.format(kinds)}`;

/** No role is held, so no other page can be offered either. */
export const ROLE_UNREAD = STOCK.notLoaded;

/** The index finds the home of a reader whose role is not known yet. */
export const goHome = (home: Page | undefined): string =>
  home === undefined ? "Go to Your Home Page" : `Go to ${home.name}`;

/** A role's home says what that role will do there, not only that it is unbuilt. */
const WHILE_UNBUILT: ReadonlyMap<Page, string> = new Map([
  [
    ASK.home,
    "Ask through your assistant for now. Your questions and their answers will be listed here.",
  ],
]);

export const unbuiltLineOf = (home: Page): string =>
  WHILE_UNBUILT.get(home) ?? "This page is coming soon.";

/** Claude is the one assistant admitted. Revisit or remove once S2b's Ask is built. */
export const CONNECT_ASSISTANT = {
  heading: "Connect Claude as Your Assistant",
  steps: [
    "In Claude, open “Settings”, then “Connectors”, and choose “Add custom connector”.",
    `Name it ${PRODUCT_NAME}, give it this address, and choose “Add”.`,
    "Choose “Connect”, sign in here if you’re asked to, then choose “Connect” again.",
  ],
  copy: "Copy Address",
  copied: "Address copied successfully.",
  asYou: "Claude will act as you in this workspace.",
} as const;
