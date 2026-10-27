import type { ROLES } from "@better-answers/schema";

import type { IconName } from "./icon.tsx";

export type Role = (typeof ROLES)[number];

export type RoleOrOperator = Role | "operator";

type Action = {
  readonly name: string;
  readonly asks: string;
  readonly icon: IconName;
};

export const INVITE_A_PERSON = {
  name: "Invite a Person",
  asks: "invite",
  icon: "invite",
} as const satisfies Action;

type Detail = {
  readonly param: string;
};

export type Owns = { readonly collections: readonly string[]; readonly concepts: number };

export const OWNS_NOTHING: Owns = { collections: [], concepts: 0 };

const OWNING = {
  "of-a-collection": (owns) => owns.collections.length > 0,
  "of-anything": (owns) => owns.collections.length > 0 || owns.concepts > 0,
} as const satisfies Readonly<Record<string, (owns: Owns) => boolean>>;

export type Page = {
  readonly name: string;
  readonly path: `/${string}`;
  readonly icon: IconName;
  readonly built: boolean;
  readonly seenBy: readonly RoleOrOperator[];
  readonly owners?: keyof typeof OWNING;
  readonly movedFrom?: readonly string[];
  readonly actions?: readonly Action[];
  readonly detail?: Detail;
};

export type MenuGroup = {
  readonly id: string;
  readonly name?: string;
  readonly summary?: string;
  readonly pages: readonly Page[];
  readonly movedFrom?: readonly string[];
};

export type Area = {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly menuGroups: readonly MenuGroup[];
};

const EVERY_ROLE = ["Admin", "Editor", "Viewer"] as const satisfies readonly Role[];

const ADMINS = ["Admin"] as const satisfies readonly Role[];

const THE_OPERATOR = ["operator"] as const satisfies readonly RoleOrOperator[];

export const ASK = {
  id: "ask",
  name: "Ask",
  icon: "ask",
  menuGroups: [
    {
      id: "ask",
      pages: [
        {
          name: "New Question",
          path: "/ask/new-question",
          icon: "new-question",
          built: true,
          seenBy: EVERY_ROLE,
          movedFrom: ["/ask"],
        },
        {
          name: "Your Questions",
          path: "/ask/your-questions",
          icon: "history",
          built: true,
          seenBy: EVERY_ROLE,
          detail: { param: "record" },
        },
        {
          name: "Connect Claude",
          path: "/ask/connect-claude",
          icon: "connect",
          built: true,
          seenBy: EVERY_ROLE,
        },
      ],
    },
  ],
} as const satisfies Area;

export const KNOWLEDGE = {
  id: "knowledge",
  name: "Knowledge",
  icon: "map",
  menuGroups: [
    {
      id: "browse",
      name: "Browse",
      summary: "Search this workspace.",
      pages: [
        {
          name: "Search",
          path: "/knowledge/search",
          icon: "search",
          built: true,
          seenBy: EVERY_ROLE,
          detail: { param: "concept" },
        },
        {
          name: "Guides",
          path: "/knowledge/guides",
          icon: "guides",
          built: false,
          seenBy: EVERY_ROLE,
        },
        {
          name: "Knowledge Base",
          path: "/knowledge/knowledge-base",
          icon: "knowledge-base",
          built: true,
          seenBy: EVERY_ROLE,
        },
      ],
    },
    {
      id: "curation",
      name: "Curation",
      summary: "Manage knowledge.",
      pages: [
        {
          name: "All Knowledge",
          path: "/knowledge/all-knowledge",
          icon: "table",
          built: false,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          name: "Due for Verification",
          path: "/knowledge/due-for-verification",
          icon: "verification",
          built: false,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          name: "Conflicts",
          path: "/knowledge/conflicts",
          icon: "conflicts",
          built: false,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          name: "Kinds",
          path: "/knowledge/kinds",
          icon: "kinds",
          built: false,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          name: "Collections and Owners",
          path: "/knowledge/collections-and-owners",
          icon: "owners",
          built: true,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          name: "Exports",
          path: "/knowledge/exports",
          icon: "exports",
          built: false,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
      ],
    },
  ],
} as const satisfies Area;

export const INBOX = {
  id: "inbox",
  name: "Inbox",
  icon: "tray",
  menuGroups: [
    {
      id: "inbox",
      pages: [
        {
          name: "Waiting on You",
          path: "/inbox/waiting-on-you",
          icon: "tray",
          built: true,
          seenBy: ADMINS,
          owners: "of-anything",
          detail: { param: "suggestion" },
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
      summary: "See what needs attention.",
      pages: [
        { name: "Overview", path: "/overview", icon: "overview", built: false, seenBy: ADMINS },
      ],
    },
    {
      id: "suggestions",
      name: "Suggestions",
      summary: "Review suggested changes.",
      pages: [
        {
          name: "To Decide",
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
      summary: "Manage documents.",
      movedFrom: ["/sources"],
      pages: [
        {
          name: "Connected Sources",
          path: "/sources/connected-sources",
          icon: "database",
          built: true,
          seenBy: ADMINS,
          movedFrom: ["/sources/bindings"],
        },
        {
          name: "Publishing Rules",
          path: "/sources/publishing-rules",
          icon: "gates",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Cost Estimates",
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
          name: "Removed at Source",
          path: "/sources/removed-at-source",
          icon: "gone",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Share Agents",
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
      summary: "Manage models and spend.",
      pages: [
        {
          name: "Models and Spend",
          path: "/models/models-and-spend",
          icon: "models",
          built: true,
          seenBy: ADMINS,
          movedFrom: ["/system/routes-and-spend", "/agent-operations/routes-and-spend"],
        },
        {
          name: "Spending Limit",
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
      summary: "Review questions and answers.",
      pages: [
        {
          name: "Questions Asked",
          path: "/questions/questions-asked",
          icon: "question",
          built: true,
          seenBy: ADMINS,
        },
        {
          name: "Answer Tests",
          path: "/questions/answer-tests",
          icon: "tests",
          built: true,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "people",
      name: "People",
      summary: "Manage members.",
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
          name: "Personal Tokens",
          path: "/people/personal-tokens",
          icon: "token",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "personal-data",
      name: "Personal Data",
      summary: "Manage personal data.",
      pages: [
        {
          name: "Erasure and Suppression",
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
      summary: "View status and activity.",
      movedFrom: ["/system"],
      pages: [
        {
          name: "Audit Log",
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

export const CONSOLE = {
  id: "console",
  name: "Console",
  icon: "console",
  menuGroups: [
    {
      id: "people",
      name: "People",
      summary: "Manage people.",
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
          name: "Names Waiting",
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
      summary: "View all workspaces.",
      movedFrom: ["/console/workspaces"],
      pages: [
        {
          name: "Every Workspace",
          path: "/console/workspaces/every-workspace",
          icon: "workspaces",
          built: true,
          seenBy: THE_OPERATOR,
        },
      ],
    },
  ],
} as const satisfies Area;

export const AREAS: readonly Area[] = [ASK, KNOWLEDGE, INBOX, CONTROL_CENTRE];

export const EVERY_AREA: readonly Area[] = [...AREAS, CONSOLE];

type Declared =
  | typeof ASK
  | typeof KNOWLEDGE
  | typeof INBOX
  | typeof CONTROL_CENTRE
  | typeof CONSOLE;

export type PagePath = Declared["menuGroups"][number]["pages"][number]["path"];

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

export const pageNamed = <Held extends MenuGroup>(
  group: Held,
  name: Held["pages"][number]["name"],
): Page => {
  const page = group.pages.find((candidate) => candidate.name === name);
  if (page === undefined) throw new Error(`${group.id} has no page named ${name}`);
  return page;
};

const NEW_QUESTION = pageNamed(menuGroupIn(ASK, "ask"), "New Question");

export const HOMES = {
  Admin: pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members"),
  Editor: NEW_QUESTION,
  Viewer: NEW_QUESTION,
  operator: pageNamed(menuGroupIn(CONSOLE, "workspaces"), "Every Workspace"),
} as const satisfies { readonly [who in RoleOrOperator]: Page };

export type Reader = {
  readonly role: RoleOrOperator | undefined;
  readonly owns: Owns;
};

export const readerOf = (role: RoleOrOperator | undefined, owns: Owns = OWNS_NOTHING): Reader => ({
  role,
  owns,
});

export const OPERATOR_READER: Reader = readerOf("operator");

export type VisibleArea = Area & { readonly opensAt: Page };

export type VisibleTree = {
  readonly areas: readonly VisibleArea[];
  readonly home: Page | undefined;
};

export const NO_TREE: VisibleTree = { areas: [], home: undefined };

const sees = (role: RoleOrOperator, owns: Owns, page: Page): boolean =>
  page.built &&
  (page.seenBy.includes(role) || (page.owners !== undefined && OWNING[page.owners](owns)));

const shownOf = (
  area: Area,
  seen: (page: Page) => boolean,
  home: Page,
): VisibleArea | undefined => {
  const shown = area.menuGroups
    .map((group) => ({ ...group, pages: group.pages.filter(seen) }))
    .filter((group) => group.pages.length > 0);
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
  readonly detail?: string;
};

const placesIn = <Held extends Area>(area: Held): readonly Place<Held>[] =>
  area.menuGroups.flatMap((menuGroup) =>
    menuGroup.pages.map((page) => ({ area, menuGroup, page })),
  );

export const pagesOf = (areas: readonly Area[]): readonly Page[] =>
  areas.flatMap(placesIn).map(({ page }) => page);

const detailIn = (page: Page, pathname: string): string | undefined => {
  const beneath = `${page.path}/`;
  if (page.detail === undefined || !pathname.startsWith(beneath)) return undefined;
  const segment = pathname.slice(beneath.length);
  return segment === "" || segment.includes("/") ? undefined : segment;
};

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

export const detailAt = (page: Page, value: string): string => {
  if (page.detail === undefined) throw new Error(`${page.path} declares no detail address`);
  return `${page.path}/${encodeURIComponent(value)}`;
};

export const hides = (tree: VisibleTree, path: string): boolean =>
  tree.home !== undefined && placeAt(tree.areas, path) === undefined;

export const headingOf = (page: Page): string => {
  const place = placeAt(EVERY_AREA, page.path);
  return place?.menuGroup?.name ?? place?.area.name ?? page.name;
};

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

export const leadsTo = (tree: VisibleTree, moved: Moved): Page | undefined => {
  const shown = pagesOf(tree.areas);
  return moved.to.find((page) => shown.includes(page));
};
