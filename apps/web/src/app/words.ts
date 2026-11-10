import type { Page } from "@/shared/navigation.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

export const FAILED_PAGE = {
  heading: "This page didn’t load",
  said: STOCK.general,
  retry: "Try again",
} as const;

export const UNKNOWN_PAGE = {
  heading: "Page not found",
  signIn: "Sign in",
} as const;

export const RAIL = "Areas";

export const SKIP_TO_MAIN = "Skip to main content";

export const NAVIGATION_SHEET = "Menu";

export const BREADCRUMB = "Breadcrumb";

export const ALL_WORKSPACES = "All workspaces";

export const switchedInAnotherTab = (workspace: string): string =>
  `You switched to ${workspace} in another browser tab.`;

export const TOGGLE = {
  hide: "Hide menu",
  show: "Show menu",
} as const;

export const JUMP_TO = {
  name: "Jump to",
  said: "Type to search.",
  list: "Matches",
  groups: { areas: "Areas", pages: "Pages", actions: "Actions", members: "Members" },
  kinds: { page: "a page", member: "a member", action: "an action" },
  membersLoading: "Loading members…",
  membersUnread: "Members didn’t load. Close this and try again.",
} as const;

export const searchFor = (typed: string): string => `Search for “${typed}”`;

const EITHER = new Intl.ListFormat("en-GB", { type: "disjunction" });

export const findWhat = (kinds: readonly string[]): string => `Find ${EITHER.format(kinds)}`;

export const ROLE_UNREAD = STOCK.notLoaded;

export const goHome = (home: Page | undefined): string =>
  home === undefined ? "Go to your home page" : `Go to ${home.name}`;

export const UNBUILT_LINE = "This page is coming soon.";

export const CONNECT_ASSISTANT = {
  heading: "Connect Claude as your assistant",
  steps: [
    "In Claude, open “Settings”, then “Connectors”, and choose “Add custom connector”.",
    `Name it ${PRODUCT_NAME}, give it this address, and choose “Add”.`,
    "Choose “Connect”, sign in here if you’re asked to, then choose “Connect” again.",
    "In the connector’s settings, set its read-only tools to “Always allow”.",
  ],
  copy: "Copy address",
  copied: "Address copied.",
  asYou: "Claude will act as you in this workspace.",
} as const;
