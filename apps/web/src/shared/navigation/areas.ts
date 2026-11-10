import type { ROLES } from "@better-answers/schema";

import type { IconName } from "@/shared/icon.tsx";

export type Role = (typeof ROLES)[number];

export type RoleOrOperator = Role | "operator";

type Action = {
  readonly name: string;
  readonly asks: string;
  readonly icon: IconName;
};

export const INVITE_A_PERSON = {
  name: "Invite a person",
  asks: "invite",
  icon: "invite",
} as const satisfies Action;

type Detail = {
  readonly param: string;
};

export type Owns = { readonly collections: readonly string[]; readonly concepts: number };

export const OWNS_NOTHING: Owns = { collections: [], concepts: 0 };

export const OWNING = {
  "of-a-collection": (owns) => owns.collections.length > 0,
  "of-anything": (owns) => owns.collections.length > 0 || owns.concepts > 0,
} as const satisfies Readonly<Record<string, (owns: Owns) => boolean>>;

export type Page = {
  readonly id: string;
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
          id: "new-question",
          name: "New question",
          path: "/ask/new-question",
          icon: "new-question",
          built: true,
          seenBy: EVERY_ROLE,
          movedFrom: ["/ask"],
        },
        {
          id: "your-questions",
          name: "Your questions",
          path: "/ask/your-questions",
          icon: "history",
          built: true,
          seenBy: EVERY_ROLE,
          detail: { param: "record" },
        },
        {
          id: "connect-claude",
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
      pages: [
        {
          id: "search",
          name: "Search",
          path: "/knowledge/search",
          icon: "search",
          built: true,
          seenBy: EVERY_ROLE,
          detail: { param: "concept" },
        },
        {
          id: "guides",
          name: "Guides",
          path: "/knowledge/guides",
          icon: "guides",
          built: true,
          seenBy: EVERY_ROLE,
          detail: { param: "guide" },
        },
        {
          id: "knowledge-base",
          name: "Knowledge base",
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
      pages: [
        {
          id: "all-knowledge",
          name: "All knowledge",
          path: "/knowledge/all-knowledge",
          icon: "table",
          built: true,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          id: "due-for-verification",
          name: "Due for verification",
          path: "/knowledge/due-for-verification",
          icon: "verification",
          built: false,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          id: "conflicts",
          name: "Conflicts",
          path: "/knowledge/conflicts",
          icon: "conflicts",
          built: false,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          id: "concept-types",
          name: "Concept types",
          path: "/knowledge/types",
          icon: "types",
          built: true,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          id: "collections-and-owners",
          name: "Collections and owners",
          path: "/knowledge/collections-and-owners",
          icon: "owners",
          built: true,
          seenBy: ADMINS,
          owners: "of-a-collection",
        },
        {
          id: "exports",
          name: "Exports",
          path: "/knowledge/exports",
          icon: "exports",
          built: true,
          seenBy: ADMINS,
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
          id: "waiting-on-you",
          name: "Waiting on you",
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
      pages: [
        {
          id: "overview",
          name: "Overview",
          path: "/overview",
          icon: "overview",
          built: false,
          seenBy: ADMINS,
        },
      ],
    },
    {
      id: "suggestions",
      name: "Suggestions",
      pages: [
        {
          id: "to-decide",
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
      movedFrom: ["/sources"],
      pages: [
        {
          id: "connected-sources",
          name: "Connected sources",
          path: "/sources/connected-sources",
          icon: "database",
          built: true,
          seenBy: ADMINS,
          movedFrom: ["/sources/bindings"],
        },
        {
          id: "publishing-rules",
          name: "Publishing rules",
          path: "/sources/publishing-rules",
          icon: "gates",
          built: false,
          seenBy: ADMINS,
        },
        {
          id: "cost-estimates",
          name: "Cost estimates",
          path: "/sources/cost-estimates",
          icon: "price",
          built: false,
          seenBy: ADMINS,
        },
        {
          id: "backlogs",
          name: "Backlogs",
          path: "/sources/backlogs",
          icon: "backlog",
          built: false,
          seenBy: ADMINS,
        },
        {
          id: "removed-at-source",
          name: "Removed at source",
          path: "/sources/removed-at-source",
          icon: "gone",
          built: false,
          seenBy: ADMINS,
        },
        {
          id: "share-agents",
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
      pages: [
        {
          id: "models-and-spend",
          name: "Models and spend",
          path: "/models/models-and-spend",
          icon: "models",
          built: true,
          seenBy: ADMINS,
          movedFrom: ["/system/routes-and-spend", "/agent-operations/routes-and-spend"],
        },
        {
          id: "spending-limit",
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
      pages: [
        {
          id: "questions-asked",
          name: "Questions asked",
          path: "/questions/questions-asked",
          icon: "question",
          built: true,
          seenBy: ADMINS,
        },
        {
          id: "answer-tests",
          name: "Answer tests",
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
      movedFrom: ["/people"],
      pages: [
        {
          id: "members",
          name: "Members",
          path: "/people/members",
          icon: "people",
          built: true,
          seenBy: ADMINS,
          actions: [INVITE_A_PERSON],
          detail: { param: "personId" },
        },
        {
          id: "groups",
          name: "Groups",
          path: "/people/groups",
          icon: "groups",
          built: true,
          seenBy: ADMINS,
        },
        {
          id: "personal-tokens",
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
      pages: [
        {
          id: "erasure-and-suppression",
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
      movedFrom: ["/system"],
      pages: [
        {
          id: "audit-log",
          name: "Audit log",
          path: "/system/audit-log",
          icon: "log",
          built: true,
          seenBy: ADMINS,
          movedFrom: ["/people/audit-log"],
        },
        {
          id: "signals",
          name: "Signals",
          path: "/system/signals",
          icon: "signals",
          built: false,
          seenBy: ADMINS,
        },
        {
          id: "health",
          name: "Health",
          path: "/system/health",
          icon: "pulse",
          built: false,
          seenBy: ADMINS,
        },
        {
          id: "backups",
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
      movedFrom: ["/console/people"],
      pages: [
        {
          id: "everyone",
          name: "Everyone",
          path: "/console/people/everyone",
          icon: "people",
          built: true,
          seenBy: THE_OPERATOR,
        },
        {
          id: "flagged-names",
          name: "Flagged names",
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
      movedFrom: ["/console/workspaces"],
      pages: [
        {
          id: "every-workspace",
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

export const AREAS: readonly Area[] = [ASK, KNOWLEDGE, INBOX, CONTROL_CENTRE];

export const EVERY_AREA: readonly Area[] = [...AREAS, CONSOLE];

type Declared =
  | typeof ASK
  | typeof KNOWLEDGE
  | typeof INBOX
  | typeof CONTROL_CENTRE
  | typeof CONSOLE;

export type PagePath = Declared["menuGroups"][number]["pages"][number]["path"];
