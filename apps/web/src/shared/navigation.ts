import type { ROLES } from "@better-answers/schema";

import type { IconName } from "./icon.tsx";

/** A workspace role, as the session's membership names it. */
export type Role = (typeof ROLES)[number];

/** The operator holds no role in the console, so its screens are shown to the mark instead. */
export type Seer = Role | "operator";

export type Screen = {
  readonly name: string;
  readonly path: string;
  readonly icon: IconName;
  readonly built: boolean;
  readonly seenBy: readonly Seer[];
  /** Shown as well to anyone owning a domain, whatever their role. */
  readonly owners?: true;
  /** An older address, which leads here only for a person who may see the screen. */
  readonly movedFrom?: string;
};

export type Group = {
  readonly id: string;
  /** Absent where the surface lists its screens alone, as Ask and Inbox do. */
  readonly name?: string;
  readonly summary?: string;
  readonly screens: readonly Screen[];
  /** An older address naming the group, which leads to its first screen the person may see. */
  readonly movedFrom?: string;
};

export type Surface = {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly groups: readonly Group[];
  /** An address of the surface's own, standing as a role's home while none of its screens is built. */
  readonly home?: Screen;
};

const EVERY_ROLE = ["Admin", "Editor", "Viewer"] as const satisfies readonly Role[];

const ADMINS = ["Admin"] as const satisfies readonly Role[];

const THE_OPERATOR = ["operator"] as const satisfies readonly Seer[];

export const ASK = {
  id: "ask",
  name: "Ask",
  icon: "ask",
  home: { name: "Ask", path: "/ask", icon: "ask", built: false, seenBy: EVERY_ROLE },
  groups: [
    {
      id: "ask",
      screens: [
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
} as const satisfies Surface;

const KNOWLEDGE = {
  id: "knowledge",
  name: "Knowledge",
  icon: "map",
  groups: [
    {
      id: "browse",
      name: "Browse",
      summary: "What this workspace knows, to search and read.",
      screens: [
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
      summary: "Everything this workspace knows, what needs checking, and who owns each domain.",
      screens: [
        {
          name: "All knowledge",
          path: "/knowledge/all-knowledge",
          icon: "table",
          built: false,
          seenBy: ADMINS,
          owners: true,
        },
        {
          name: "Checks due",
          path: "/knowledge/checks-due",
          icon: "checks",
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
          name: "Domains and owners",
          path: "/knowledge/domains-and-owners",
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
} as const satisfies Surface;

const INBOX = {
  id: "inbox",
  name: "Inbox",
  icon: "tray",
  groups: [
    {
      id: "inbox",
      screens: [
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
} as const satisfies Surface;

export const CONTROL_CENTRE = {
  id: "control-centre",
  name: "Control Centre",
  icon: "control-centre",
  groups: [
    {
      id: "overview",
      name: "Overview",
      summary: "Where this workspace needs your attention.",
      screens: [
        { name: "Overview", path: "/overview", icon: "overview", built: false, seenBy: ADMINS },
      ],
    },
    {
      id: "suggestions",
      name: "Suggestions",
      summary: "Suggested changes waiting for a decision.",
      screens: [
        {
          name: "Queue",
          path: "/suggestions/queue",
          icon: "queue",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "sources",
      name: "Sources",
      summary: "The documents this workspace learns from.",
      movedFrom: "/sources",
      screens: [
        {
          name: "Bindings",
          path: "/sources/bindings",
          icon: "database",
          built: true,
          seenBy: ADMINS,
        },
        {
          name: "Publish and accept gates",
          path: "/sources/publish-and-accept-gates",
          icon: "gates",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Priced plan",
          path: "/sources/priced-plan",
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
          name: "Gone-at-source impact",
          path: "/sources/gone-at-source-impact",
          icon: "gone",
          built: false,
          seenBy: ADMINS,
        },
        {
          name: "Agent tokens",
          path: "/sources/agent-tokens",
          icon: "token",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "agent-operations",
      name: "Agent Operations",
      summary: "The model each purpose runs on, and what it spends.",
      screens: [
        {
          name: "Routes and spend",
          path: "/agent-operations/routes-and-spend",
          icon: "routes",
          built: true,
          seenBy: ADMINS,
          movedFrom: "/system/routes-and-spend",
        },
        {
          name: "Ceiling",
          path: "/agent-operations/ceiling",
          icon: "ceiling",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "questions",
      name: "Questions",
      summary: "The questions asked in this workspace, and the answers they got.",
      screens: [
        {
          name: "Answer audit",
          path: "/questions/answer-audit",
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
      movedFrom: "/people",
      screens: [
        { name: "Members", path: "/people/members", icon: "people", built: true, seenBy: ADMINS },
        { name: "Groups", path: "/people/groups", icon: "groups", built: true, seenBy: ADMINS },
        { name: "Tokens", path: "/people/tokens", icon: "token", built: false, seenBy: ADMINS },
      ],
    },
    {
      id: "personal-data",
      name: "Personal data",
      summary: "The personal data this workspace holds, and requests to erase or suppress it.",
      screens: [
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
      movedFrom: "/system",
      screens: [
        {
          name: "Audit log",
          path: "/system/audit-log",
          icon: "log",
          built: true,
          seenBy: ADMINS,
          movedFrom: "/people/audit-log",
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
} as const satisfies Surface;

/** Reached from the workspace switcher, never the rail. */
export const CONSOLE = {
  id: "console",
  name: "Console",
  icon: "console",
  groups: [
    {
      id: "people",
      name: "People",
      summary:
        "Every person on the platform, the workspaces they belong to and their role in each, with the sessions and grants that can act as them.",
      movedFrom: "/console/people",
      screens: [
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
        "Every workspace on the platform, with its slug, its member count and the day it was provisioned. Provisioning and renaming are ops commands, so this list is read-only.",
      movedFrom: "/console/workspaces",
      screens: [
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
} as const satisfies Surface;

/** The workspace's rail, in its order. */
export const SURFACES: readonly Surface[] = [ASK, KNOWLEDGE, INBOX, CONTROL_CENTRE];

export const EVERY_SURFACE: readonly Surface[] = [...SURFACES, CONSOLE];

type Declared =
  | typeof ASK
  | typeof KNOWLEDGE
  | typeof INBOX
  | typeof CONTROL_CENTRE
  | typeof CONSOLE;

/** Every declared address, so a link written outside the list stops compiling when it moves. */
export type ScreenPath =
  | Declared["groups"][number]["screens"][number]["path"]
  | (typeof ASK)["home"]["path"];

type GroupOf<Held extends Surface> = Held["groups"][number];

export const groupIn = <Held extends Surface, Id extends GroupOf<Held>["id"]>(
  surface: Held,
  id: Id,
): Extract<GroupOf<Held>, { readonly id: Id }> => {
  const group = surface.groups.find(
    (candidate): candidate is Extract<GroupOf<Held>, { readonly id: Id }> => candidate.id === id,
  );
  if (group === undefined) throw new Error(`${surface.name} has no group ${id}`);
  return group;
};

/** A screen's address read off the list, so a link to it is never a second copy. */
export const screenNamed = <Held extends Group>(
  group: Held,
  name: Held["screens"][number]["name"],
): Screen => {
  const screen = group.screens.find((candidate) => candidate.name === name);
  if (screen === undefined) throw new Error(`${group.id} has no screen named ${name}`);
  return screen;
};

/** Where each reader lands, and the way back offered when they are lost. */
export const HOMES = {
  Admin: screenNamed(groupIn(CONTROL_CENTRE, "people"), "Members"),
  Editor: ASK.home,
  Viewer: ASK.home,
  operator: screenNamed(groupIn(CONSOLE, "workspaces"), "Every workspace"),
} as const satisfies { readonly [seer in Seer]: Screen };

export type Reader = {
  /** Undefined until the membership read answers, so nothing role-gated shows meanwhile. */
  readonly role: Seer | undefined;
  readonly owns: readonly string[];
};

/** `opensAt` is where its rail entry leads: the reader's home when it is here. */
export type VisibleSurface = Surface & { readonly opensAt: Screen };

export type VisibleTree = {
  readonly surfaces: readonly VisibleSurface[];
  /** Undefined exactly when no role is held. */
  readonly home: Screen | undefined;
};

const sees = (role: Seer, owns: readonly string[], screen: Screen): boolean =>
  screen.built && (screen.seenBy.includes(role) || (screen.owners === true && owns.length > 0));

const shownOf = (
  surface: Surface,
  seen: (screen: Screen) => boolean,
  home: Screen,
): VisibleSurface | undefined => {
  const groups = surface.groups
    .map((group) => ({ ...group, screens: group.screens.filter(seen) }))
    .filter((group) => group.screens.length > 0);
  // A home standing in for unbuilt screens is the surface's one entry.
  const shown = surface.home === home ? [{ id: surface.id, screens: [home] }, ...groups] : groups;
  const first = shown[0]?.screens[0];
  if (first === undefined) return undefined;

  const holdsHome = shown.some((group) => group.screens.includes(home));
  return {
    id: surface.id,
    name: surface.name,
    icon: surface.icon,
    groups: shown,
    opensAt: holdsHome ? home : first,
  };
};

/** Built-ness and the reader filter the list; a role's home shows whether built or not. */
export const visibleTo = (reader: Reader, surfaces: readonly Surface[]): VisibleTree => {
  const { role, owns } = reader;
  if (role === undefined) return { surfaces: [], home: undefined };

  const home = HOMES[role];
  const seen = (screen: Screen) => screen === home || sees(role, owns, screen);
  return {
    surfaces: surfaces.flatMap((surface) => shownOf(surface, seen, home) ?? []),
    home,
  };
};

export type Place<Held extends Surface = Surface> = {
  readonly surface: Held;
  readonly group: Group | undefined;
  readonly screen: Screen;
};

const placesIn = <Held extends Surface>(surface: Held): readonly Place<Held>[] => [
  ...(surface.home === undefined ? [] : [{ surface, group: undefined, screen: surface.home }]),
  ...surface.groups.flatMap((group) => group.screens.map((screen) => ({ surface, group, screen }))),
];

/** An exact match: an address beneath a screen's names no place. */
export const placeAt = <Held extends Surface>(
  surfaces: readonly Held[],
  pathname: string,
): Place<Held> | undefined =>
  surfaces.flatMap(placesIn).find((place) => place.screen.path === pathname);

/** With no role held nothing is hidden, so a screen draws its own loading or failed state. */
export const hides = (tree: VisibleTree, path: string): boolean =>
  tree.home !== undefined && placeAt(tree.surfaces, path) === undefined;

/** What a screen's first heading says: its group's name, or its surface's where it has none. */
export const headingOf = (screen: Screen): string => {
  const place = placeAt(EVERY_SURFACE, screen.path);
  return place?.group?.name ?? place?.surface.name ?? screen.name;
};

export type Moved = { readonly from: string; readonly to: Screen | Group };

export const movedWithin = (surfaces: readonly Surface[]): readonly Moved[] =>
  surfaces.flatMap((surface) =>
    surface.groups.flatMap((group) => [
      ...(group.movedFrom === undefined ? [] : [{ from: group.movedFrom, to: group }]),
      ...group.screens.flatMap((screen) =>
        screen.movedFrom === undefined ? [] : [{ from: screen.movedFrom, to: screen }],
      ),
    ]),
  );

/** Undefined where the reader may see nothing the older address now names. */
export const leadsTo = (tree: VisibleTree, moved: Moved): Screen | undefined => {
  const shown = tree.surfaces.flatMap((surface) =>
    surface.groups.flatMap((group) => group.screens),
  );
  const named = "screens" in moved.to ? moved.to.screens : [moved.to];
  return named.find((screen) => shown.includes(screen));
};
