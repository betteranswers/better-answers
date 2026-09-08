/**
 * The sample data the blocks are demonstrated with: the workspace in the design ("Thunder
 * AI"), its rail sections, one secondary nav per section, the four views, and the dashboard
 * tiles. Nothing here is fetched — a screen passes this, or its own data of the same shape.
 */
import type {
  Crumb,
  Identifier,
  RailSection,
  SectionNav,
  Tile,
  Viewer,
  Workspace,
  WorkspaceView,
} from "@/features/workspace/types.ts";

export const SAMPLE_WORKSPACE: Workspace = {
  id: "ws_thunder",
  name: "Thunder AI",
  slug: "thunder-ai",
  plan: "Scale",
};

export const SAMPLE_WORKSPACES: readonly Workspace[] = [
  SAMPLE_WORKSPACE,
  { id: "ws_northstar", name: "Northstar Studio", slug: "northstar-studio", plan: "Pro" },
  { id: "ws_harbour", name: "Harbour Labs", slug: "harbour-labs", plan: "Free" },
];

export const SAMPLE_VIEWER: Viewer = {
  memberId: "mem_8f21c4",
  name: "Ada Whitfield",
  handle: "@ada",
  avatarUrl:
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80",
  presence: "online",
};

export const SAMPLE_RAIL: readonly RailSection[] = [
  { id: "sec_insights", label: "Insights", icon: "chart", place: "top" },
  { id: "sec_people", label: "People", icon: "people", place: "top" },
  { id: "sec_trust", label: "Trust", icon: "shield", place: "top" },
  { id: "sec_developers", label: "Developers", icon: "code", place: "top" },
  { id: "sec_documents", label: "Documents", icon: "document", place: "top" },
  { id: "sec_alerts", label: "Alerts", icon: "bell", place: "top", badgeCount: 3 },
  { id: "sec_inbox", label: "Mail", icon: "envelope", place: "bottom" },
  { id: "sec_tasks", label: "Task board", icon: "clipboard", place: "bottom" },
  { id: "sec_settings", label: "Settings", icon: "gear", place: "bottom" },
];

const PEOPLE_NAV: SectionNav = {
  sectionId: "sec_people",
  items: [
    { id: "nav_home", label: "Home", icon: "broadcast" },
    { id: "nav_updates", label: "Updates", icon: "people" },
    { id: "nav_inbox", label: "Inbox", icon: "tray" },
    { id: "nav_clients", label: "Clients", icon: "gear", tone: "beta" },
    { id: "nav_tasks", label: "My Tasks", icon: "trend" },
  ],
  groups: [
    {
      id: "grp_workspaces",
      label: "Workspaces",
      canCreate: true,
      defaultOpen: true,
      items: [
        { id: "nav_concepts", label: "Business Concepts", icon: "briefcase" },
        { id: "nav_northstar", label: "Northstar Studio", icon: "palette" },
        { id: "nav_teams", label: "Teams", icon: "people", tone: "pro" },
        { id: "nav_reports", label: "Reports", icon: "chart" },
      ],
    },
    {
      id: "grp_communities",
      label: "Communities",
      canCreate: true,
      defaultOpen: true,
      items: [
        { id: "nav_create_community", label: "Create A Community", icon: "plus" },
        { id: "nav_designers", label: "Designers Hub", icon: "palette", handle: "@designers" },
        { id: "nav_react", label: "React Js", icon: "code", handle: "@react" },
        { id: "nav_node", label: "Node Js", icon: "pulse", handle: "@node" },
      ],
    },
  ],
};

const INSIGHTS_NAV: SectionNav = {
  sectionId: "sec_insights",
  items: [
    { id: "nav_overview", label: "Overview", icon: "chart" },
    { id: "nav_funnels", label: "Funnels", icon: "trend" },
    { id: "nav_retention", label: "Retention", icon: "pulse" },
  ],
  groups: [
    {
      id: "grp_saved",
      label: "Saved reports",
      canCreate: true,
      defaultOpen: true,
      items: [
        { id: "nav_weekly", label: "Weekly rollup", icon: "document", handle: "rpt_4a19" },
        { id: "nav_billing", label: "Billing health", icon: "briefcase", handle: "rpt_77c2" },
      ],
    },
  ],
};

const TRUST_NAV: SectionNav = {
  sectionId: "sec_trust",
  items: [
    { id: "nav_sessions", label: "Sessions", icon: "shield" },
    { id: "nav_tokens", label: "API tokens", icon: "code" },
    { id: "nav_sso", label: "Single sign-on", icon: "gear" },
    { id: "nav_audit", label: "Audit log", icon: "document" },
  ],
  groups: [
    {
      id: "grp_providers",
      label: "Identity providers",
      canCreate: true,
      defaultOpen: true,
      items: [
        { id: "nav_okta", label: "Okta", icon: "shield", handle: "idp_okta_01" },
        { id: "nav_entra", label: "Microsoft Entra", icon: "shield", handle: "idp_entra_02" },
      ],
    },
  ],
};

/** One nav per rail section: choosing a rail item swaps the whole nav. */
export const SAMPLE_NAVS: Readonly<Record<Identifier, SectionNav>> = {
  sec_insights: INSIGHTS_NAV,
  sec_people: PEOPLE_NAV,
  sec_trust: TRUST_NAV,
  sec_developers: TRUST_NAV,
  sec_documents: INSIGHTS_NAV,
  sec_alerts: PEOPLE_NAV,
  sec_inbox: PEOPLE_NAV,
  sec_tasks: PEOPLE_NAV,
  sec_settings: TRUST_NAV,
};

export const SAMPLE_VIEWS: readonly WorkspaceView[] = [
  { id: "view_list", label: "List", kind: "list" },
  { id: "view_kanban", label: "Kanban", kind: "kanban" },
  { id: "view_calendar", label: "Calendar", kind: "calendar" },
  { id: "view_dashboard", label: "Dashboard", kind: "dashboard" },
];

export const SAMPLE_CRUMBS: readonly Crumb[] = [
  { id: "crumb_home", label: "Home" },
  { id: "crumb_updates", label: "Updates" },
];

export const SAMPLE_TILES: readonly Tile[] = [
  {
    id: "tile_active",
    title: "Active members",
    caption: "Last 7 days",
    metric: "1,248",
    delta: "+4.2%",
    trend: "up",
    provenance: "src: mem_index · 09:41 UTC",
    state: "ready",
    span: "single",
  },
  {
    id: "tile_sessions",
    title: "Open sessions",
    caption: "Right now",
    metric: "312",
    delta: "-1.8%",
    trend: "down",
    provenance: "src: ses_live · 09:41 UTC",
    state: "ready",
    span: "single",
  },
  {
    id: "tile_tokens",
    title: "API tokens in use",
    caption: "Rolling 24 hours",
    metric: "87",
    delta: "+0.0%",
    trend: "flat",
    provenance: "src: tok_ba_… · 09:38 UTC",
    state: "ready",
    span: "single",
  },
  {
    id: "tile_updates",
    title: "Updates published",
    caption: "This month",
    metric: "64",
    delta: "+12.5%",
    trend: "up",
    provenance: "src: upd_stream · 09:30 UTC",
    state: "ready",
    span: "single",
  },
  {
    id: "tile_sso",
    title: "SSO sign-ins",
    caption: "Last 7 days",
    metric: "2,904",
    delta: "+7.1%",
    trend: "up",
    provenance: "src: idp_okta_01 · 09:12 UTC",
    state: "loading",
    span: "single",
  },
  {
    id: "tile_tasks",
    title: "Tasks assigned to you",
    caption: "Open",
    metric: "9",
    delta: "-3",
    trend: "down",
    provenance: "src: tsk_queue · 09:41 UTC",
    state: "ready",
    span: "single",
  },
  {
    id: "tile_timeline",
    title: "Workspace activity",
    caption: "Last 30 days",
    metric: "18,402",
    delta: "+9.6%",
    trend: "up",
    provenance: "src: evt_log · ws_thunder · 09:41 UTC",
    state: "ready",
    span: "full",
  },
];
