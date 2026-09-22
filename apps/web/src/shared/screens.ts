export const SCREENS = [
  {
    id: "sources",
    name: "Sources",
    icon: "database",
    path: "/sources",
    summary:
      "The workspace's source bindings, what each one is allowed to reach, and the gates that publish and accept what it brings in.",
    defaultView: "/sources/bindings",
    views: [
      { name: "Bindings", path: "/sources/bindings", built: false },
      { name: "Publish and accept gates", path: "/sources/publish-and-accept-gates", built: false },
      { name: "Priced plan", path: "/sources/priced-plan", built: false },
      { name: "Backlogs", path: "/sources/backlogs", built: false },
      { name: "Gone-at-source impact", path: "/sources/gone-at-source-impact", built: false },
      { name: "Agent tokens", path: "/sources/agent-tokens", built: false },
      { name: "Ceiling", path: "/sources/ceiling", built: false },
    ],
  },
  {
    id: "suggestions",
    name: "Suggestions",
    icon: "tray",
    path: "/suggestions",
    summary: "Every suggestion waiting on a decision, in one queue.",
    defaultView: "/suggestions/queue",
    views: [{ name: "Queue", path: "/suggestions/queue", built: false }],
  },
  {
    id: "knowledge",
    name: "Knowledge",
    icon: "map",
    path: "/knowledge",
    summary:
      "The review table over every concept and composition on the workspace's map, with its conflicts and its verification requests.",
    defaultView: "/knowledge/review-table",
    views: [
      { name: "Review table", path: "/knowledge/review-table", built: false },
      {
        name: "Conflicts and verification requests",
        path: "/knowledge/conflicts-and-verification-requests",
        built: false,
      },
      { name: "Exports", path: "/knowledge/exports", built: false },
    ],
  },
  {
    id: "questions",
    name: "Questions",
    icon: "question",
    path: "/questions",
    summary: "The answer audit — every question the workspace asked, the flagged ones first.",
    defaultView: "/questions/answer-audit",
    views: [
      { name: "Answer audit", path: "/questions/answer-audit", built: false },
      { name: "Promotions", path: "/questions/promotions", built: false },
      { name: "Answer tests", path: "/questions/answer-tests", built: false },
    ],
  },
  {
    id: "people",
    name: "People",
    icon: "people",
    path: "/people",
    summary: "The workspace's members and their roles, with owners, thresholds and tokens.",
    defaultView: "/people/roles",
    views: [
      { name: "Roles", path: "/people/roles", built: false },
      { name: "Owners", path: "/people/owners", built: false },
      { name: "Thresholds", path: "/people/thresholds", built: false },
      { name: "Erasure and suppression", path: "/people/erasure-and-suppression", built: false },
      { name: "Tokens", path: "/people/tokens", built: false },
    ],
  },
  {
    id: "system",
    name: "System",
    icon: "pulse",
    path: "/system",
    summary: "Signals, health, routes and spend, and backups.",
    defaultView: "/system/routes-and-spend",
    views: [
      { name: "Signals", path: "/system/signals", built: false },
      { name: "Health", path: "/system/health", built: false },
      { name: "Routes and spend", path: "/system/routes-and-spend", built: true },
      { name: "Backups", path: "/system/backups", built: false },
    ],
  },
] as const;

export type Screen = (typeof SCREENS)[number];
export type ScreenId = Screen["id"];
export type View = Screen["views"][number];

export const screenById = (id: ScreenId): Screen => {
  const screen = SCREENS.find((candidate) => candidate.id === id);
  if (screen === undefined) throw new Error(`no screen is named ${id}`);
  return screen;
};

// A union of tuple types has no callable array methods; the element type restores them.
export const viewsOf = (screen: Screen): readonly View[] => screen.views;

// Any address beneath a screen is on that screen; the trailing slash keeps a longer name
// from matching a shorter screen's.
export const screenAt = (pathname: string): Screen | undefined =>
  SCREENS.find((screen) => pathname === screen.path || pathname.startsWith(`${screen.path}/`));

export const viewAt = (pathname: string): View | undefined =>
  SCREENS.flatMap((screen) => viewsOf(screen)).find((view) => view.path === pathname);
