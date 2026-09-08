/**
 * Region one of the workspace shell: the icon rail.
 *
 * Registry items needed beyond the installed set: tooltip.
 * (Until it is installed the rail names each control with an aria-label and a hover card
 * built from the installed `hover-card`, so no icon ever carries meaning alone.)
 *
 * The rail is a single-select list of sections: picking one swaps the secondary nav beside
 * it. Square corners, a 1px hairline against the nav, no shadow, and the only bold glyph in
 * the app — the active rail item — as the register prescribes. On a narrow viewport the rail
 * lies down as a horizontal scroller so a 320px screen still reflows (WCAG 2.2 AA).
 */
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/shared/ui/hover-card.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { WorkspaceIcon } from "@/features/workspace/workspace-icons.tsx";
import type { Identifier, RailSection } from "@/features/workspace/types.ts";

export type IconRailProps = {
  readonly sections: readonly RailSection[];
  readonly activeSectionId: Identifier;
  readonly markLabel: string;
  readonly onSelectSection: (sectionId: Identifier) => void;
};

export function IconRail({ sections, activeSectionId, markLabel, onSelectSection }: IconRailProps) {
  const top = sections.filter((section) => section.place === "top");
  const bottom = sections.filter((section) => section.place === "bottom");

  return (
    <nav
      aria-label="Sections"
      className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-2 md:h-full md:w-14 md:flex-col md:items-stretch md:gap-2 md:border-r md:border-b-0 md:px-2 md:py-3"
    >
      <div
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center bg-primary font-mono text-base font-semibold text-primary-foreground"
      >
        {markLabel}
      </div>

      <ul className="flex flex-1 items-center gap-1 overflow-x-auto md:flex-col md:items-stretch md:gap-1 md:overflow-visible md:pt-2">
        {top.map((section) => (
          <RailItem
            key={section.id}
            section={section}
            active={section.id === activeSectionId}
            onSelect={onSelectSection}
          />
        ))}
      </ul>

      <ul className="hidden gap-1 md:flex md:flex-col md:pb-1">
        {bottom.map((section) => (
          <RailItem
            key={section.id}
            section={section}
            active={section.id === activeSectionId}
            onSelect={onSelectSection}
          />
        ))}
      </ul>
    </nav>
  );
}

function RailItem({
  section,
  active,
  onSelect,
}: {
  readonly section: RailSection;
  readonly active: boolean;
  readonly onSelect: (sectionId: Identifier) => void;
}) {
  return (
    <li>
      <HoverCard openDelay={220} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={section.label}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(section.id)}
            className={cn(
              "relative flex size-10 items-center justify-center transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0.13,1)]",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <WorkspaceIcon name={section.icon} active={active} size={18} />
            {section.badgeCount === undefined ? null : (
              <span className="absolute top-1 right-1 min-w-4 bg-destructive px-1 font-mono text-[11px] leading-4 font-medium text-destructive-foreground">
                {section.badgeCount}
              </span>
            )}
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-auto px-3 py-2">
          <p className="text-sm font-medium text-foreground">{section.label}</p>
        </HoverCardContent>
      </HoverCard>
    </li>
  );
}
