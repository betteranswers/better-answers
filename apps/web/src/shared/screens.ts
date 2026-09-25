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
      { name: "Bindings", path: "/sources/bindings", built: true },
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
    summary:
      "The workspace's members, their roles and groups, with owners, thresholds, tokens and the audit log.",
    defaultView: "/people/members",
    views: [
      { name: "Members", path: "/people/members", built: true },
      { name: "Groups", path: "/people/groups", built: false },
      { name: "Owners", path: "/people/owners", built: false },
      { name: "Thresholds", path: "/people/thresholds", built: false },
      { name: "Erasure and suppression", path: "/people/erasure-and-suppression", built: false },
      { name: "Tokens", path: "/people/tokens", built: false },
      { name: "Audit log", path: "/people/audit-log", built: true },
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

export const CONSOLE_SCREENS = [
  {
    id: "people",
    name: "People",
    icon: "people",
    path: "/console/people",
    summary:
      "Every person on the platform, the workspaces they belong to and their role in each, with the sessions and grants that can act as them.",
    defaultView: "/console/people/everyone",
    views: [
      { name: "Everyone", path: "/console/people/everyone", built: false },
      { name: "Names waiting", path: "/console/people/names-waiting", built: false },
    ],
  },
  {
    id: "workspaces",
    name: "Workspaces",
    icon: "workspaces",
    path: "/console/workspaces",
    summary:
      "Every workspace on the platform, with its slug, its member count and the day it was provisioned. Provisioning and renaming are ops commands, so this list is read-only.",
    defaultView: "/console/workspaces/every-workspace",
    views: [{ name: "Every workspace", path: "/console/workspaces/every-workspace", built: true }],
  },
] as const;

export type Screen = (typeof SCREENS)[number] | (typeof CONSOLE_SCREENS)[number];
export type View = Screen["views"][number];

const screenIn = <Held extends Screen>(screens: readonly Held[], id: Held["id"]): Held => {
  const screen = screens.find((candidate) => candidate.id === id);
  if (screen === undefined) throw new Error(`no screen is named ${id}`);
  return screen;
};

export const screenById = (id: (typeof SCREENS)[number]["id"]): Screen => screenIn(SCREENS, id);

export const consoleScreenById = (id: (typeof CONSOLE_SCREENS)[number]["id"]): Screen =>
  screenIn(CONSOLE_SCREENS, id);

/** The shell's regions draw one of these; `home` is where a reader who lost their way is sent. */
export type Surface = {
  readonly name: "Control Centre" | "Console";
  readonly nameInProse: "Control Centre" | "the console";
  readonly screens: readonly Screen[];
  readonly home: Screen;
};

export const CONTROL_CENTRE: Surface = {
  name: "Control Centre",
  nameInProse: "Control Centre",
  screens: SCREENS,
  home: screenById("system"),
};

export const CONSOLE: Surface = {
  name: "Console",
  nameInProse: "the console",
  screens: CONSOLE_SCREENS,
  home: consoleScreenById("workspaces"),
};

/** A union of tuple types has no callable array methods; the element type restores them. */
export const viewsOf = (screen: Screen): readonly View[] => screen.views;

/**
 * Any address beneath a screen is on that screen; the trailing slash keeps a longer name
 * from matching a shorter screen's.
 */
export const screenAt = (surface: Surface, pathname: string): Screen | undefined =>
  surface.screens.find(
    (screen) => pathname === screen.path || pathname.startsWith(`${screen.path}/`),
  );

/** An exact match: a screen's own address, with no view open, answers undefined. */
export const viewAt = (surface: Surface, pathname: string): View | undefined =>
  surface.screens.flatMap((screen) => viewsOf(screen)).find((view) => view.path === pathname);
