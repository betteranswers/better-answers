import {
  BookOpenIcon,
  BroadcastIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  CaretUpDownIcon,
  ChatTextIcon,
  ClockCounterClockwiseIcon,
  CloudArrowUpIcon,
  ColumnsIcon,
  CurrencyGbpIcon,
  DatabaseIcon,
  EraserIcon,
  ExportIcon,
  FileXIcon,
  FlagIcon,
  GaugeIcon,
  GlobeIcon,
  GraphIcon,
  IdentificationBadgeIcon,
  IdentificationCardIcon,
  KeyIcon,
  KeyboardIcon,
  ListIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PathIcon,
  PlugsConnectedIcon,
  PulseIcon,
  QuestionIcon,
  ScrollIcon,
  ShapesIcon,
  ShieldCheckIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  StackIcon,
  TableIcon,
  TestTubeIcon,
  TrayIcon,
  TreeStructureIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  UsersThreeIcon,
  WarningIcon,
  XIcon,
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
  | "knowledge-base"
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
  ask: ChatTextIcon,
  backlog: StackIcon,
  backups: CloudArrowUpIcon,
  "caret-down": CaretDownIcon,
  "caret-right": CaretRightIcon,
  "spending-limit": GaugeIcon,
  columns: ColumnsIcon,
  conflicts: WarningIcon,
  connect: PlugsConnectedIcon,
  console: GlobeIcon,
  "control-centre": SlidersHorizontalIcon,
  database: DatabaseIcon,
  erasure: EraserIcon,
  exports: ExportIcon,
  flag: FlagIcon,
  gates: ShieldCheckIcon,
  gone: FileXIcon,
  groups: UsersThreeIcon,
  guides: BookOpenIcon,
  history: ClockCounterClockwiseIcon,
  invite: UserPlusIcon,
  keystrokes: KeyboardIcon,
  kinds: ShapesIcon,
  "knowledge-base": TreeStructureIcon,
  log: ScrollIcon,
  map: GraphIcon,
  names: IdentificationCardIcon,
  navigation: ListIcon,
  "new-question": NotePencilIcon,
  overview: SquaresFourIcon,
  owners: IdentificationBadgeIcon,
  people: UsersIcon,
  person: UserIcon,
  price: CurrencyGbpIcon,
  pulse: PulseIcon,
  question: QuestionIcon,
  "to-decide": ListChecksIcon,
  remove: XIcon,
  models: PathIcon,
  search: MagnifyingGlassIcon,
  menu: SidebarSimpleIcon,
  signals: BroadcastIcon,
  "sorted-ascending": CaretUpIcon,
  "sorted-descending": CaretDownIcon,
  table: TableIcon,
  tests: TestTubeIcon,
  token: KeyIcon,
  tray: TrayIcon,
  unsorted: CaretUpDownIcon,
  verification: CalendarCheckIcon,
  workspaces: BuildingsIcon,
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
