import {
  BookOpen,
  Broadcast,
  Buildings,
  CalendarCheck,
  CaretDown,
  CaretRight,
  CaretUp,
  CaretUpDown,
  ChatText,
  ClockCounterClockwise,
  CloudArrowUp,
  Columns,
  CurrencyGbp,
  Database,
  Eraser,
  Export,
  FileX,
  Flag,
  Gauge,
  Globe,
  Graph,
  IdentificationBadge,
  IdentificationCard,
  Key,
  Keyboard,
  List,
  ListChecks,
  MagnifyingGlass,
  NotePencil,
  Path,
  Pulse,
  Question,
  Scroll,
  Shapes,
  ShieldCheck,
  SidebarSimple,
  SlidersHorizontal,
  SquaresFour,
  Stack,
  Table,
  TestTube,
  Tray,
  User,
  UserPlus,
  Users,
  UsersThree,
  Warning,
  type Icon as PhosphorGlyph,
} from "@phosphor-icons/react";

import { cn } from "@/shared/lib/utils.ts";

/** Phosphor stands in until the product has a set of its own; one family, one door to it. */
export type IconName =
  | "ask"
  | "backlog"
  | "backups"
  | "caret-down"
  | "caret-right"
  | "ceiling"
  | "checks"
  | "columns"
  | "conflicts"
  | "console"
  | "control-centre"
  | "database"
  | "erasure"
  | "exports"
  | "flag"
  | "gates"
  | "gone"
  | "groups"
  | "guides"
  | "history"
  | "invite"
  | "keystrokes"
  | "kinds"
  | "log"
  | "map"
  | "names"
  | "navigation"
  | "new-question"
  | "overview"
  | "owners"
  | "people"
  | "person"
  | "price"
  | "pulse"
  | "question"
  | "queue"
  | "routes"
  | "search"
  | "secondary-nav"
  | "signals"
  | "sorted-ascending"
  | "sorted-descending"
  | "table"
  | "tests"
  | "token"
  | "tray"
  | "unsorted"
  | "workspaces";

/**
 * The keys are the glossary's words, not Phosphor's: the shell says navigation and secondary
 * nav, never list or sidebar.
 */
const GLYPHS = {
  ask: ChatText,
  backlog: Stack,
  backups: CloudArrowUp,
  "caret-down": CaretDown,
  "caret-right": CaretRight,
  ceiling: Gauge,
  checks: CalendarCheck,
  columns: Columns,
  conflicts: Warning,
  console: Globe,
  "control-centre": SlidersHorizontal,
  database: Database,
  erasure: Eraser,
  exports: Export,
  flag: Flag,
  gates: ShieldCheck,
  gone: FileX,
  groups: UsersThree,
  guides: BookOpen,
  history: ClockCounterClockwise,
  invite: UserPlus,
  keystrokes: Keyboard,
  kinds: Shapes,
  log: Scroll,
  map: Graph,
  names: IdentificationCard,
  navigation: List,
  "new-question": NotePencil,
  overview: SquaresFour,
  owners: IdentificationBadge,
  people: Users,
  person: User,
  price: CurrencyGbp,
  pulse: Pulse,
  question: Question,
  queue: ListChecks,
  routes: Path,
  search: MagnifyingGlass,
  "secondary-nav": SidebarSimple,
  signals: Broadcast,
  "sorted-ascending": CaretUp,
  "sorted-descending": CaretDown,
  table: Table,
  tests: TestTube,
  token: Key,
  tray: Tray,
  unsorted: CaretUpDown,
  workspaces: Buildings,
} satisfies Readonly<Record<IconName, PhosphorGlyph>>;

/** Hidden from assistive technology, so the caller names what it stands for beside it. */
export function Icon(properties: {
  readonly name: IconName;
  /** Bold marks the open entry in the rail or the secondary nav, and nothing else. */
  readonly weight?: "regular" | "bold";
  readonly className?: string;
}) {
  const Glyph = GLYPHS[properties.name];

  return (
    <Glyph
      aria-hidden
      focusable={false}
      weight={properties.weight ?? "regular"}
      className={cn("size-4 shrink-0", properties.className)}
    />
  );
}
