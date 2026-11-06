import {
  ArchiveIcon,
  BookOpenIcon,
  BroadcastIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  CaretUpDownIcon,
  ChatTextIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  ClockCountdownIcon,
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
  PencilSimpleLineIcon,
  PlugsConnectedIcon,
  PulseIcon,
  QuestionIcon,
  ScrollIcon,
  SealCheckIcon,
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
  WarningCircleIcon,
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
  | "changed-since-verified"
  | "spending-limit"
  | "columns"
  | "conflicts"
  | "connect"
  | "console"
  | "control-centre"
  | "database"
  | "deprecated"
  | "draft"
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
  | "out-of-date"
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
  | "unverified"
  | "verification"
  | "verified-automatically"
  | "verified-by"
  | "workspaces";

const GLYPHS = {
  ask: ChatTextIcon,
  backlog: StackIcon,
  backups: CloudArrowUpIcon,
  "caret-down": CaretDownIcon,
  "caret-right": CaretRightIcon,
  "changed-since-verified": WarningCircleIcon,
  "spending-limit": GaugeIcon,
  columns: ColumnsIcon,
  conflicts: WarningIcon,
  connect: PlugsConnectedIcon,
  console: GlobeIcon,
  "control-centre": SlidersHorizontalIcon,
  database: DatabaseIcon,
  deprecated: ArchiveIcon,
  draft: PencilSimpleLineIcon,
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
  "out-of-date": ClockCountdownIcon,
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
  unverified: CircleDashedIcon,
  verification: CalendarCheckIcon,
  "verified-automatically": CheckCircleIcon,
  "verified-by": SealCheckIcon,
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
