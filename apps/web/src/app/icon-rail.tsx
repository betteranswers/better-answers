import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import type { VisibleSurface } from "@/shared/navigation.ts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip.tsx";

import { RAIL } from "./words.ts";

/** A beat before the first one, so a pointer crossing the rail on its way elsewhere opens none. */
const HOVER_DELAY_MS = 200;

/** `tooltips` is for a rail of icons alone; where each entry shows its name, leave it off. */
export function IconRail(properties: {
  readonly surfaces: readonly VisibleSurface[];
  readonly openSurfaceId: string | undefined;
  readonly tooltips: boolean;
  readonly onChoose?: () => void;
  /** The utilities under the surfaces. The sheet has none: its rail sits in a dialog. */
  readonly foot?: ReactNode;
}) {
  return (
    <nav
      aria-label={RAIL}
      /* Sticky under the band rather than a scroll region: a pane that scrolls on its own is
         one a keyboard can miss. */
      className="shrink-0 border-b border-border bg-sidebar px-2 py-2 md:sticky md:top-[var(--band-drawn-h)] md:flex md:h-[calc(100vh-var(--band-drawn-h))] md:w-rail md:flex-col md:self-start md:border-r md:border-b-0 md:py-1"
    >
      <TooltipProvider delayDuration={HOVER_DELAY_MS}>
        <ul className="flex flex-col gap-1">
          {properties.surfaces.map((surface) => {
            const open = surface.id === properties.openSurfaceId;

            const entry = (
              <Link
                to={surface.opensAt.path}
                onClick={properties.onChoose}
                // The router marks only a link to the address itself, and a surface is open on
                // any of its screens.
                aria-current={open ? "page" : undefined}
                className={cn(
                  // A fill and a bold glyph where the rest have neither, so greyscale
                  // tells the open surface apart.
                  "flex h-10 items-center gap-2 px-2 transition-colors md:w-10 md:justify-center md:px-0",
                  open
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon name={surface.icon} weight={open ? "bold" : "regular"} />
                <span className="md:sr-only">{surface.name}</span>
              </Link>
            );

            return (
              <li key={surface.id}>
                {/* What an icon alone owes a pointer and a keyboard; beside a name on the row
                    it says the same twice and eats an Escape. */}
                {properties.tooltips ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{entry}</TooltipTrigger>
                    <TooltipContent side="right">{surface.name}</TooltipContent>
                  </Tooltip>
                ) : (
                  entry
                )}
              </li>
            );
          })}
        </ul>

        {properties.foot === undefined ? null : (
          <div className="mt-auto pt-2">{properties.foot}</div>
        )}
      </TooltipProvider>
    </nav>
  );
}
