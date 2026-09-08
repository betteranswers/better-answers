/**
 * The one place a token icon name becomes a Phosphor glyph.
 *
 * Registry items needed beyond the installed set: none.
 *
 * Phosphor only, never Lucide; regular weight everywhere except an active rail item, which
 * the design draws bold. Every glyph is 16px in the interface, inherits `currentColor` and
 * is `aria-hidden` — an icon never carries meaning alone, so each call site pairs it with a
 * visible label or an aria-label.
 */
import {
  Bell,
  Briefcase,
  Broadcast,
  ChartBar,
  ClipboardText,
  Code,
  Envelope,
  FileText,
  Gear,
  House,
  Palette,
  Plus,
  Pulse,
  ShieldCheck,
  TrendUp,
  Tray,
  UsersThree,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import type { IconName } from "@/features/workspace/types.ts";

const GLYPHS: Readonly<Record<IconName, PhosphorIcon>> = {
  chart: ChartBar,
  people: UsersThree,
  shield: ShieldCheck,
  code: Code,
  document: FileText,
  bell: Bell,
  envelope: Envelope,
  clipboard: ClipboardText,
  gear: Gear,
  house: House,
  broadcast: Broadcast,
  tray: Tray,
  trend: TrendUp,
  briefcase: Briefcase,
  palette: Palette,
  plus: Plus,
  pulse: Pulse,
};

export type WorkspaceIconProps = {
  readonly name: IconName;
  /** Bold is reserved for the active tab-rail item; everything else stays regular. */
  readonly active?: boolean;
  readonly size?: number;
  readonly className?: string;
};

export function WorkspaceIcon({ name, active = false, size = 16, className }: WorkspaceIconProps) {
  const Glyph = GLYPHS[name];
  return (
    <Glyph
      aria-hidden
      focusable={false}
      size={size}
      weight={active ? "bold" : "regular"}
      color="currentColor"
      className={className}
    />
  );
}
