import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { RAIL } from "@/app/words.ts";
import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import type { VisibleArea } from "@/shared/navigation.ts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip.tsx";

const HOVER_DELAY_MS = 200;

export function IconRail(properties: {
  readonly areas: readonly VisibleArea[];
  readonly openAreaId: string | undefined;
  readonly tooltips: boolean;
  readonly onChoose?: () => void;
  readonly foot?: ReactNode;
}) {
  return (
    <nav
      aria-label={RAIL}
      className="shrink-0 border-b border-border bg-sidebar px-2 py-2 md:sticky md:top-[var(--band-drawn-h)] md:flex md:h-[calc(100vh-var(--band-drawn-h))] md:w-rail md:flex-col md:self-start md:border-r md:border-b-0 md:py-1"
    >
      <TooltipProvider delayDuration={HOVER_DELAY_MS}>
        <ul className="flex flex-col gap-1">
          {properties.areas.map((area) => {
            const open = area.id === properties.openAreaId;

            const entry = (
              <Link
                to={area.opensAt.path}
                onClick={properties.onChoose}
                aria-current={open ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-2 px-2 transition-colors md:w-10 md:justify-center md:px-0",
                  open
                    ? "bg-[var(--surface-active)] text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon name={area.icon} weight={open ? "bold" : "regular"} />
                <span className="md:sr-only">{area.name}</span>
              </Link>
            );

            return (
              <li key={area.id}>
                {/* What an icon alone owes a pointer and a keyboard; beside a name on the row
                    it says the same twice and eats an Escape. */}
                {properties.tooltips ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{entry}</TooltipTrigger>
                    <TooltipContent side="right">{area.name}</TooltipContent>
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
