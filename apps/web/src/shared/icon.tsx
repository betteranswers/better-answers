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
  PlugsConnected,
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
  X,
  type Icon as PhosphorGlyph,
} from "@phosphor-icons/react";

import { cn } from "@/shared/lib/utils.ts";

export type IconName =
  | "ask"
  | "backlog"
  | "backups"
  | "caret-down"
  | "caret-right"
  | "spending-limit"
  | "columns"
  | "conflicts"
  | "connect"
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
  | "to-decide"
  | "remove"
  | "models"
  | "search"
  | "menu"
  | "signals"
  | "sorted-ascending"
  | "sorted-descending"
  | "table"
  | "tests"
  | "token"
  | "tray"
  | "unsorted"
  | "verification"
  | "workspaces";

const GLYPHS = {
  ask: ChatText,
  backlog: Stack,
  backups: CloudArrowUp,
  "caret-down": CaretDown,
  "caret-right": CaretRight,
  "spending-limit": Gauge,
  columns: Columns,
  conflicts: Warning,
  connect: PlugsConnected,
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
  "to-decide": ListChecks,
  remove: X,
  models: Path,
  search: MagnifyingGlass,
  menu: SidebarSimple,
  signals: Broadcast,
  "sorted-ascending": CaretUp,
  "sorted-descending": CaretDown,
  table: Table,
  tests: TestTube,
  token: Key,
  tray: Tray,
  unsorted: CaretUpDown,
  verification: CalendarCheck,
  workspaces: Buildings,
} satisfies Readonly<Record<IconName, PhosphorGlyph>>;

export function Icon(properties: {
  readonly name: IconName;
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
