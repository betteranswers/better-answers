import { Link } from "@tanstack/react-router";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { SCREENS, type ScreenId } from "@/shared/screens.ts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip.tsx";

// A beat before the first one, so a pointer crossing the rail on its way elsewhere opens none.
const HOVER_DELAY_MS = 200;

export function IconRail(properties: { readonly openScreenId: ScreenId | undefined }) {
  return (
    <nav
      aria-label="Control Centre"
      /* Sticky at the page's own height rather than a scroll region: a pane that scrolls on
         its own is one a keyboard can miss. */
      className="shrink-0 border-b border-border bg-sidebar px-2 py-2 md:sticky md:top-0 md:h-screen md:w-rail md:self-start md:border-r md:border-b-0 md:py-1"
    >
      <TooltipProvider delayDuration={HOVER_DELAY_MS}>
        <ul className="flex flex-col gap-1">
          {SCREENS.map((screen) => {
            const open = screen.id === properties.openScreenId;

            return (
              <li key={screen.id}>
                {/* The name is read where the rail has the width; the tooltip is what a
                    narrow icon owes a pointer and a keyboard. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={screen.path}
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
                  </TooltipTrigger>
                  <TooltipContent side="right">{screen.name}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </TooltipProvider>
    </nav>
  );
}
