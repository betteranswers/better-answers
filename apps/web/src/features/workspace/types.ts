/**
 * The typed vocabulary the workspace shell blocks speak.
 *
 * Every block in this folder takes props and calls callbacks — nothing here fetches, routes
 * or reaches for global state, so a screen can be assembled, tested and story-booked from
 * plain data. Identity and machine strings (workspace slugs, member ids, session ids, view
 * ids) are their own named types because the visual register sets them in Geist Mono and a
 * reader must be able to tell a name from an identifier at a glance.
 */

/** A machine string: rendered in Geist Mono wherever it is shown. */
export type Identifier = string;

export type IconName =
  | "chart"
  | "people"
  | "shield"
  | "code"
  | "document"
  | "bell"
  | "envelope"
  | "clipboard"
  | "gear"
  | "house"
  | "broadcast"
  | "tray"
  | "trend"
  | "briefcase"
  | "palette"
  | "plus"
  | "pulse";

export type RailSection = {
  readonly id: Identifier;
  readonly label: string;
  readonly icon: IconName;
  /** Rail items split into a top cluster and a bottom cluster, as in the design. */
  readonly place: "top" | "bottom";
  readonly badgeCount?: number | undefined;
};

export type NavTone = "beta" | "pro";

export type NavItem = {
  readonly id: Identifier;
  readonly label: string;
  readonly icon: IconName;
  readonly tone?: NavTone;
  /** A machine string shown in the hover card, e.g. a workspace slug. */
  readonly handle?: Identifier;
};

export type NavGroup = {
  readonly id: Identifier;
  readonly label: string;
  readonly items: readonly NavItem[];
  /** When true the group header shows a "+" that calls onCreateInGroup. */
  readonly canCreate: boolean;
  readonly defaultOpen: boolean;
};

/** The secondary nav swaps wholesale per rail section: one section, one nav. */
export type SectionNav = {
  readonly sectionId: Identifier;
  /** The ungrouped items that sit directly under the workspace switcher. */
  readonly items: readonly NavItem[];
  readonly groups: readonly NavGroup[];
};

export type Workspace = {
  readonly id: Identifier;
  readonly name: string;
  readonly slug: Identifier;
  readonly plan: string;
};

export type Viewer = {
  readonly memberId: Identifier;
  readonly name: string;
  readonly handle: Identifier;
  readonly avatarUrl?: string;
  readonly presence: "online" | "away" | "offline";
};

export type ViewKind = "list" | "kanban" | "calendar" | "dashboard";

export type WorkspaceView = {
  readonly id: Identifier;
  readonly label: string;
  readonly kind: ViewKind;
};

export type Crumb = {
  readonly id: Identifier;
  readonly label: string;
};

export type ToolbarControl = "sort" | "view" | "filter";

/** A dashboard tile. `state` drives the skeleton the design shows while a tile loads. */
export type Tile = {
  readonly id: Identifier;
  readonly title: string;
  readonly caption: string;
  readonly metric: string;
  readonly delta: string;
  readonly trend: "up" | "down" | "flat";
  readonly provenance: string;
  readonly state: "ready" | "loading";
  /** A wide tile spans the full grid, like the last card in the design. */
  readonly span: "single" | "full";
};

/** The two tones the app's Outcome pattern has: an expected result, or a refusal. */
export type OutcomeTone = "said" | "refused";

export type OutcomeMessage = {
  readonly tone: OutcomeTone;
  readonly text: string;
};
