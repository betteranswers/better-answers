import {
  Buildings,
  CaretDown,
  Database,
  Flag,
  Graph,
  List,
  MagnifyingGlass,
  Pulse,
  Question,
  SidebarSimple,
  Tray,
  Users,
  type Icon as PhosphorGlyph,
} from "@phosphor-icons/react";

import { cn } from "@/shared/lib/utils.ts";

/** Phosphor stands in until the product has a set of its own; one family, one door to it. */
export type IconName =
  | "caret-down"
  | "database"
  | "flag"
  | "map"
  | "navigation"
  | "people"
  | "pulse"
  | "question"
  | "search"
  | "secondary-nav"
  | "tray"
  | "workspaces";

/**
 * The keys are the glossary's words, not Phosphor's: the shell says navigation and secondary
 * nav, never list or sidebar.
 */
const GLYPHS = {
  "caret-down": CaretDown,
  database: Database,
  flag: Flag,
  map: Graph,
  navigation: List,
  people: Users,
  pulse: Pulse,
  question: Question,
  search: MagnifyingGlass,
  "secondary-nav": SidebarSimple,
  tray: Tray,
  workspaces: Buildings,
} satisfies Readonly<Record<IconName, PhosphorGlyph>>;

/** Hidden from assistive technology, so the caller names what it stands for beside it. */
export function Icon(properties: {
  readonly name: IconName;
  /** Bold is the open rail entry's and nothing else's: it is the register's one heavy glyph. */
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
