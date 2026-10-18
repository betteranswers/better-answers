import type { Page } from "@/shared/navigation.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

export const FAILED_PAGE = {
  heading: "This Page Didn’t Load",
  said: STOCK.general,
  retry: "Try Again",
} as const;

export const UNKNOWN_PAGE = {
  heading: "Page Not Found",
  signIn: "Sign In",
} as const;

export const RAIL = "Areas";

export const NAVIGATION_SHEET = "Menu";

export const BREADCRUMB = "Breadcrumb";

export const ALL_WORKSPACES = "All Workspaces";

export const switchedInAnotherTab = (workspace: string): string =>
  `You switched to ${workspace} in another browser tab.`;

export const TOGGLE = {
  hide: "Hide Menu",
  show: "Show Menu",
} as const;

export const JUMP_TO = {
  name: "Jump To",
  said: "Type to search.",
  list: "Matches",
  groups: { areas: "Areas", pages: "Pages", actions: "Actions", members: "Members" },
  kinds: { page: "a page", member: "a member", action: "an action" },
  membersLoading: "The members are still loading.",
  membersUnread: "The members didn’t load. Please close this and try again.",
} as const;

export const searchFor = (typed: string): string => `Search for “${typed}”`;

const EITHER = new Intl.ListFormat("en-GB", { type: "disjunction" });

export const findWhat = (kinds: readonly string[]): string => `Find ${EITHER.format(kinds)}`;

export const ROLE_UNREAD = STOCK.notLoaded;

export const goHome = (home: Page | undefined): string =>
  home === undefined ? "Go to Your Home Page" : `Go to ${home.name}`;

export const UNBUILT_LINE = "This page is coming soon.";

export const CONNECT_ASSISTANT = {
  heading: "Connect Claude as Your Assistant",
  steps: [
    "In Claude, open “Settings”, then “Connectors”, and choose “Add custom connector”.",
    `Name it ${PRODUCT_NAME}, give it this address, and choose “Add”.`,
    "Choose “Connect”, sign in here if you’re asked to, then choose “Connect” again.",
    `In the connector’s settings, set its read-only tools to “Always allow”, so Claude doesn’t ask before each question.`,
  ],
  copy: "Copy Address",
  copied: "Address copied successfully.",
  asYou: "Claude will act as you in this workspace.",
} as const;
