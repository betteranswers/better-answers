import { Link } from "@tanstack/react-router";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import type { Screen, Surface } from "@/shared/screens.ts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip.tsx";

/** A beat before the first one, so a pointer crossing the rail on its way elsewhere opens none. */
const HOVER_DELAY_MS = 200;

/** `tooltips` is for a rail of icons alone; where each entry shows its name, leave it off. */
export function IconRail(properties: {
  readonly surface: Surface;
  readonly openScreen: Screen | undefined;
  readonly tooltips: boolean;
  readonly onChoose?: () => void;
}) {
  return (
    <nav
      aria-label={properties.surface.name}
      /* Sticky at the page's own height rather than a scroll region: a pane that scrolls on
         its own is one a keyboard can miss. */
      className="shrink-0 border-b border-border bg-sidebar px-2 py-2 md:sticky md:top-0 md:h-screen md:w-rail md:self-start md:border-r md:border-b-0 md:py-1"
    >
      <TooltipProvider delayDuration={HOVER_DELAY_MS}>
        <ul className="flex flex-col gap-1">
          {properties.surface.screens.map((screen) => {
            const open = screen === properties.openScreen;

            const entry = (
              <Link
                to={screen.path}
                onClick={properties.onChoose}
                className={cn(
                  // A fill and a bold glyph where the rest have neither, so greyscale
                  // tells the open screen apart.
                  "flex h-10 items-center gap-2 px-2 transition-colors md:w-10 md:justify-center md:px-0",
                  open
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon name={screen.icon} weight={open ? "bold" : "regular"} />
                <span className="md:sr-only">{screen.name}</span>
              </Link>
            );

            return (
              <li key={screen.path}>
                {/* What an icon alone owes a pointer and a keyboard; beside a name on the row
                    it says the same twice and eats an Escape. */}
                {properties.tooltips ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{entry}</TooltipTrigger>
                    <TooltipContent side="right">{screen.name}</TooltipContent>
                  </Tooltip>
                ) : (
                  entry
                )}
              </li>
            );
          })}
        </ul>
      </TooltipProvider>
    </nav>
  );
}
