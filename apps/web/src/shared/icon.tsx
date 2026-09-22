import {
  CaretDown,
  Database,
  Graph,
  Pulse,
  Question,
  Tray,
  Users,
  type Icon as PhosphorGlyph,
} from "@phosphor-icons/react";

import { cn } from "@/shared/lib/utils.ts";

// Phosphor stands in until the product has a set of its own; one family, one door to it.
export type IconName = "caret-down" | "database" | "map" | "people" | "pulse" | "question" | "tray";

// The keys are the glossary's words, not Phosphor's: a screen says map and people, never
// graph or users.
const GLYPHS = {
  "caret-down": CaretDown,
  database: Database,
  map: Graph,
  people: Users,
  pulse: Pulse,
  question: Question,
  tray: Tray,
} satisfies Readonly<Record<IconName, PhosphorGlyph>>;

export function Icon(properties: {
  readonly name: IconName;
  // Bold is the open rail entry's and nothing else's: it is the register's one heavy glyph.
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
