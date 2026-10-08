import type { ROLES } from "@better-answers/schema";

import type { IconName } from "./icon.tsx";

/** A workspace role, as the session's member names it. */
export type Role = (typeof ROLES)[number];

/** The operator holds no role in the console, so its pages are shown to the mark instead. */
export type RoleOrOperator = Role | "operator";

/** Something a page does that jump-to offers by name, to whoever may see the page. */
type Action = {
  readonly name: string;
  /** What the page's address carries to open it. */
  readonly asks: string;
  readonly icon: IconName;
};

export const INVITE_A_PERSON = {
  name: "Invite a person",
  asks: "invite",
  icon: "invite",
} as const satisfies Action;

/** One segment beneath a page, naming a row: listed nowhere, gated and framed as its page. */
type Detail = {
  readonly param: string;
};

export type Page = {
  readonly name: string;
  readonly path: string;
  readonly icon: IconName;
  readonly built: boolean;
  readonly seenBy: readonly RoleOrOperator[];
  /** Shown as well to anyone owning a collection, whatever their role. */
  readonly owners?: true;
  /** Every older address, each leading here only for a person who may see the page. */
  readonly movedFrom?: readonly string[];
  readonly actions?: readonly Action[];
  readonly detail?: Detail;
};

export type MenuGroup = {
  readonly id: string;
  /** Absent where the area lists its pages alone, as Ask and Inbox do. */
  readonly name?: string;
  readonly summary?: string;
  readonly pages: readonly Page[];
  /** Every older address naming the group, each leading to its first page the person may see. */
  readonly movedFrom?: readonly string[];
};

export type Area = {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly menuGroups: readonly MenuGroup[];
  /** An address of the area's own, standing as a role's home while none of its pages is built. */
  readonly home?: Page;
};

const EVERY_ROLE = ["Admin", "Editor", "Viewer"] as const satisfies readonly Role[];

const ADMINS = ["Admin"] as const satisfies readonly Role[];

const THE_OPERATOR = ["operator"] as const satisfies readonly RoleOrOperator[];

export const ASK = {
  id: "ask",
  name: "Ask",
  icon: "ask",
  home: { name: "Ask", path: "/ask", icon: "ask", built: false, seenBy: EVERY_ROLE },
  menuGroups: [
    {
      id: "ask",
      pages: [
        {
          name: "New question",
          path: "/ask/new-question",
          icon: "new-question",
          built: false,
          seenBy: EVERY_ROLE,
        },
        {
          name: "Your questions",
          path: "/ask/your-questions",
          icon: "history",
          built: false,
          seenBy: EVERY_ROLE,
        },
      ],
    },
  ],
} as const satisfies Area;

const KNOWLEDGE = {
  id: "knowledge",
  name: "Knowledge",
  icon: "map",
  menuGroups: [
    {
      id: "browse",
      name: "Browse",
      summary: "What this workspace knows, to search and read.",
      pages: [
        {
          name: "Search",
          path: "/knowledge/search",
          icon: "search",
          built: false,
          seenBy: EVERY_ROLE,
        },
        {
          name: "Guides",
          path: "/knowledge/guides",
          icon: "guides",
          built: false,
          seenBy: EVERY_ROLE,
        },
      ],
    },
    {
      id: "curation",
      name: "Curation",
      summary:
        "Everything this workspace knows, what needs verifying, and who owns each collection.",
      pages: [
        {
          name: "All knowledge",
          path: "/knowledge/all-knowledge",
          icon: "table",
          built: false,
          seenBy: ADMINS,
          owners: true,
        },
        {
          name: "Due for verification",
          path: "/knowledge/due-for-verification",
          icon: "verification",
          built: false,
          seenBy: ADMINS,
          owners: true,
        },
        {
          name: "Conflicts",
          path: "/knowledge/conflicts",
          icon: "conflicts",
          built: false,
          seenBy: ADMINS,
          owners: true,
        },
        {
          name: "Kinds",
          path: "/knowledge/kinds",
          icon: "kinds",
          built: false,
          seenBy: ADMINS,
          owners: true,
        },
        {
          name: "Collections and owners",
          path: "/knowledge/collections-and-owners",
          icon: "owners",
          built: false,
          seenBy: ADMINS,
          owners: true,
        },
        {
          name: "Exports",
          path: "/knowledge/exports",
          icon: "exports",
          built: false,
          seenBy: ADMINS,
          owners: true,
        },
      ],
    },
  ],
} as const satisfies Area;

const INBOX = {
  id: "inbox",
  name: "Inbox",
  icon: "tray",
  menuGroups: [
    {
      id: "inbox",
      pages: [
        {
          name: "Waiting on you",
          path: "/inbox/waiting-on-you",
          icon: "tray",
          built: false,
          seenBy: ADMINS,
          owners: true,
        },
      ],
    },
  ],
} as const satisfies Area;

export const CONTROL_CENTRE = {
  id: "control-centre",
  name: "Control Centre",
  icon: "control-centre",
  menuGroups: [
    {
      id: "overview",
      name: "Overview",
      summary: "Where this workspace needs your attention.",
      pages: [
        { name: "Overview", path: "/overview", icon: "overview", built: false, seenBy: ADMINS },
      ],
    },
    {
      id: "suggestions",
      name: "Suggestions",
      summary: "Suggested changes waiting for a decision.",
      pages: [
        {
          name: "To decide",
          path: "/suggestions/to-decide",
          icon: "to-decide",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "sources",
      name: "Sources",
      summary: "The documents this workspace learns from.",
      movedFrom: ["/sources"],
      pages: [
        {
          name: "Connected sources",
          path: "/sources/connected-sources",
          icon: "database",
          built: true,
          seenBy: ADMINS,
          movedFrom: ["/sources/bindings"],
        },
        {
          name: "Publishing rules",
          path: "/sources/publishing-rules",
          icon: "gates",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Cost estimates",
          path: "/sources/cost-estimates",
          icon: "price",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Backlogs",
          path: "/sources/backlogs",
          icon: "backlog",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Removed at source",
          path: "/sources/removed-at-source",
          icon: "gone",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Share agents",
          path: "/sources/share-agents",
          icon: "token",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "models",
      name: "Models",
      summary: "The model each purpose runs on, and what it spends.",
      pages: [
        {
          name: "Models and spend",
          path: "/models/models-and-spend",
          icon: "models",
          built: true,
          seenBy: ADMINS,
          movedFrom: ["/system/routes-and-spend", "/agent-operations/routes-and-spend"],
        },
        {
          name: "Spending limit",
          path: "/models/spending-limit",
          icon: "spending-limit",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "questions",
      name: "Questions",
      summary: "The questions asked in this workspace, and the answers they got.",
      pages: [
        {
          name: "Questions asked",
          path: "/questions/questions-asked",
          icon: "question",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Answer tests",
          path: "/questions/answer-tests",
          icon: "tests",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "people",
      name: "People",
      summary: "Who can use this workspace, and what each person can do.",
      movedFrom: ["/people"],
      pages: [
        {
          name: "Members",
          path: "/people/members",
          icon: "people",
          built: true,
          seenBy: ADMINS,
          actions: [INVITE_A_PERSON],
          detail: { param: "personId" },
        },
        { name: "Groups", path: "/people/groups", icon: "groups", built: true, seenBy: ADMINS },
        {
          name: "Personal tokens",
          path: "/people/personal-tokens",
          icon: "token",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "personal-data",
      name: "Personal data",
      summary: "The personal data this workspace holds, and requests to erase or suppress it.",
      pages: [
        {
          name: "Erasure and suppression",
          path: "/personal-data/erasure-and-suppression",
          icon: "erasure",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "system",
      name: "System",
      summary: "How this workspace is running, and a record of what was done in it.",
      movedFrom: ["/system"],
      pages: [
        {
          name: "Audit log",
          path: "/system/audit-log",
          icon: "log",
          built: true,
          seenBy: ADMINS,
          movedFrom: ["/people/audit-log"],
        },
        {
          name: "Signals",
          path: "/system/signals",
          icon: "signals",
          built: false,
          seenBy: ADMINS,
        },
        { name: "Health", path: "/system/health", icon: "pulse", built: false, seenBy: ADMINS },
        {
          name: "Backups",
          path: "/system/backups",
          icon: "backups",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
  ],
} as const satisfies Area;

/** Reached from the workspace switcher, never the rail. */
export const CONSOLE = {
  id: "console",
  name: "Console",
  icon: "console",
  menuGroups: [
    {
      id: "people",
      name: "People",
      summary:
        "Every person on the platform, the workspaces they belong to and their role in each, with the sessions and assistant access that can act as them.",
      movedFrom: ["/console/people"],
      pages: [
        {
          name: "Everyone",
          path: "/console/people/everyone",
          icon: "people",
          built: true,
          seenBy: THE_OPERATOR,
        },
        {
          name: "Names waiting",
          path: "/console/people/names-waiting",
          icon: "names",
          built: true,
          seenBy: THE_OPERATOR,
        },
      ],
    },
    {
      id: "workspaces",
      name: "Workspaces",
      summary:
        "Every workspace on the platform, with its short name, its member count and the day it was provisioned. Provisioning and renaming are ops commands, so this list is read-only.",
      movedFrom: ["/console/workspaces"],
      pages: [
        {
          name: "Every workspace",
          path: "/console/workspaces/every-workspace",
          icon: "workspaces",
          built: true,
          seenBy: THE_OPERATOR,
        },
      ],
    },
  ],
} as const satisfies Area;

/** The workspace's rail, in its order. */
export const AREAS: readonly Area[] = [ASK, KNOWLEDGE, INBOX, CONTROL_CENTRE];

export const EVERY_AREA: readonly Area[] = [...AREAS, CONSOLE];

type Declared =
  | typeof ASK
  | typeof KNOWLEDGE
  | typeof INBOX
  | typeof CONTROL_CENTRE
  | typeof CONSOLE;

/** Every declared address, so a link written outside the list stops compiling when it moves. */
export type PagePath =
  | Declared["menuGroups"][number]["pages"][number]["path"]
  | (typeof ASK)["home"]["path"];

type MenuGroupOf<Held extends Area> = Held["menuGroups"][number];

export const menuGroupIn = <Held extends Area, Id extends MenuGroupOf<Held>["id"]>(
  area: Held,
  id: Id,
): Extract<MenuGroupOf<Held>, { readonly id: Id }> => {
  const group = area.menuGroups.find(
    (candidate): candidate is Extract<MenuGroupOf<Held>, { readonly id: Id }> =>
      candidate.id === id,
  );
  if (group === undefined) throw new Error(`${area.name} has no group ${id}`);
  return group;
};

/** A page's address read off the list, so a link to it is never a second copy. */
export const pageNamed = <Held extends MenuGroup>(
  group: Held,
  name: Held["pages"][number]["name"],
): Page => {
  const page = group.pages.find((candidate) => candidate.name === name);
  if (page === undefined) throw new Error(`${group.id} has no page named ${name}`);
  return page;
};

/** Where each reader lands, and the way back offered when they are lost. */
export const HOMES = {
  Admin: pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members"),
  Editor: ASK.home,
  Viewer: ASK.home,
  operator: pageNamed(menuGroupIn(CONSOLE, "workspaces"), "Every workspace"),
} as const satisfies { readonly [who in RoleOrOperator]: Page };

export type Reader = {
  /** Undefined until the member read answers, so nothing role-gated shows meanwhile. */
  readonly role: RoleOrOperator | undefined;
  readonly owns: readonly string[];
};

/** Nothing records who owns a collection, so a page marked for owners shows by role alone. */
export const readerOf = (role: RoleOrOperator | undefined): Reader => ({ role, owns: [] });

export const OPERATOR_READER: Reader = readerOf("operator");

/** `opensAt` is where its rail entry leads: the reader's home when it is here. */
export type VisibleArea = Area & { readonly opensAt: Page };

export type VisibleTree = {
  readonly areas: readonly VisibleArea[];
  /** Undefined exactly when no role is held. */
  readonly home: Page | undefined;
};

export const NO_TREE: VisibleTree = { areas: [], home: undefined };

const sees = (role: RoleOrOperator, owns: readonly string[], page: Page): boolean =>
  page.built && (page.seenBy.includes(role) || (page.owners === true && owns.length > 0));

const shownOf = (
  area: Area,
  seen: (page: Page) => boolean,
  home: Page,
): VisibleArea | undefined => {
  const groups = area.menuGroups
    .map((group) => ({ ...group, pages: group.pages.filter(seen) }))
    .filter((group) => group.pages.length > 0);
  // A home standing in for unbuilt pages is the area's one entry.
  const shown = area.home === home ? [{ id: area.id, pages: [home] }, ...groups] : groups;
  const first = shown[0]?.pages[0];
  if (first === undefined) return undefined;

  const holdsHome = shown.some((group) => group.pages.includes(home));
  return {
    id: area.id,
    name: area.name,
    icon: area.icon,
    menuGroups: shown,
    opensAt: holdsHome ? home : first,
  };
};

/** Built-ness and the reader filter the list; a role's home shows whether built or not. */
export const visibleTo = (reader: Reader, areas: readonly Area[]): VisibleTree => {
  const { role, owns } = reader;
  if (role === undefined) return NO_TREE;

  const home = HOMES[role];
  const seen = (page: Page) => page === home || sees(role, owns, page);
  return {
    areas: areas.flatMap((area) => shownOf(area, seen, home) ?? []),
    home,
  };
};

export type Place<Held extends Area = Area> = {
  readonly area: Held;
  readonly menuGroup: MenuGroup | undefined;
  readonly page: Page;
  /** The segment a page's detail address holds, still encoded as the address has it. */
  readonly detail?: string;
};

const placesIn = <Held extends Area>(area: Held): readonly Place<Held>[] => [
  ...(area.home === undefined ? [] : [{ area, menuGroup: undefined, page: area.home }]),
  ...area.menuGroups.flatMap((menuGroup) =>
    menuGroup.pages.map((page) => ({ area, menuGroup, page })),
  ),
];

/** An area's own home first: a visible area carries none, so it adds nothing there. */
export const pagesOf = (areas: readonly Area[]): readonly Page[] =>
  areas.flatMap(placesIn).map(({ page }) => page);

/** One segment and no more, so a deeper address beneath a row names nothing. */
const detailIn = (page: Page, pathname: string): string | undefined => {
  const beneath = `${page.path}/`;
  if (page.detail === undefined || !pathname.startsWith(beneath)) return undefined;
  const segment = pathname.slice(beneath.length);
  return segment === "" || segment.includes("/") ? undefined : segment;
};

/** An exact match first, then a page's declared detail address; anything deeper is no place. */
export const placeAt = <Held extends Area>(
  areas: readonly Held[],
  pathname: string,
): Place<Held> | undefined => {
  const places = areas.flatMap(placesIn);
  const exact = places.find((place) => place.page.path === pathname);
  if (exact !== undefined) return exact;
  for (const place of places) {
    const detail = detailIn(place.page, pathname);
    if (detail !== undefined) return { ...place, detail };
  }
  return undefined;
};

/** The address of one row beneath a page that declares a detail address. */
export const detailAt = (page: Page, value: string): string => {
  if (page.detail === undefined) throw new Error(`${page.path} declares no detail address`);
  return `${page.path}/${encodeURIComponent(value)}`;
};

/** With no role held nothing is hidden, so a page draws its own loading or failed state. */
export const hides = (tree: VisibleTree, path: string): boolean =>
  tree.home !== undefined && placeAt(tree.areas, path) === undefined;

/** What a page's first heading says: its group's name, or its area's where it has none. */
export const headingOf = (page: Page): string => {
  const place = placeAt(EVERY_AREA, page.path);
  return place?.menuGroup?.name ?? place?.area.name ?? page.name;
};

/** `to` is in order: an older address leads to the first page in it the reader may see. */
export type Moved = { readonly from: string; readonly to: readonly Page[] };

const movesOf = (from: readonly string[] = [], to: readonly Page[]): readonly Moved[] =>
  from.map((address) => ({ from: address, to }));

export const movedWithin = (areas: readonly Area[]): readonly Moved[] =>
  areas.flatMap((area) =>
    area.menuGroups.flatMap((group) => [
      ...movesOf(group.movedFrom, group.pages),
      ...group.pages.flatMap((page) => movesOf(page.movedFrom, [page])),
    ]),
  );

/** Undefined where the reader may see nothing the older address now names. */
export const leadsTo = (tree: VisibleTree, moved: Moved): Page | undefined => {
  const shown = pagesOf(tree.areas);
  return moved.to.find((page) => shown.includes(page));
};
