/**
 * The shell's top bar: where you are, a search field, the section's reports, the primary
 * add action, and the viewer.
 *
 * Registry items needed beyond the installed set: avatar, tooltip, separator.
 * (The viewer chip is drawn as a circular <img> with a presence dot — the avatar is one of
 * the three circles the register allows — so the block compiles before avatar is installed.)
 *
 * Rules that shaped it: 1px hairlines and no shadow at rest; the breadcrumb's trailing crumb
 * is the accessible current page; the member id and handle are machine strings, so they are
 * set in Geist Mono. Below the medium breakpoint the search collapses into the row beneath
 * the crumbs rather than shrinking past a usable width (WCAG 2.2 AA reflow).
 */
import { MagnifyingGlass, Plus, Presentation } from "@phosphor-icons/react";

import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { Outcome } from "@/features/workspace/outcome.tsx";
import type { Crumb, OutcomeMessage, Viewer } from "@/features/workspace/types.ts";

export type WorkspaceTopbarProps = {
  readonly crumbs: readonly Crumb[];
  readonly searchValue: string;
  readonly searchPlaceholder: string;
  readonly viewer: Viewer;
  readonly outcome?: OutcomeMessage | undefined;
  readonly onSearchChange: (value: string) => void;
  readonly onOpenReports: () => void;
  readonly onAdd: () => void;
  readonly onOpenViewer: () => void;
};

export function WorkspaceTopbar({
  crumbs,
  searchValue,
  searchPlaceholder,
  viewer,
  outcome,
  onSearchChange,
  onOpenReports,
  onAdd,
  onOpenViewer,
}: WorkspaceTopbarProps) {
  const last = crumbs.length - 1;

  return (
    <header className="border-b border-border bg-background">
      <div className="flex min-h-15 flex-wrap items-center gap-3 px-4 py-2.5 md:flex-nowrap md:px-5">
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-2">
            {crumbs.map((crumb, index) => (
              <li key={crumb.id} className="flex min-w-0 items-center gap-2">
                {index === 0 ? null : (
                  <span aria-hidden className="text-muted-foreground">
                    /
                  </span>
                )}
                <span
                  aria-current={index === last ? "page" : undefined}
                  className={cn(
                    "truncate",
                    index === last ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {crumb.label}
                </span>
              </li>
            ))}
          </ol>
        </nav>

        <div className="order-3 w-full md:order-none md:w-56 lg:w-72">
          <label htmlFor="workspace-search" className="sr-only">
            Search this workspace
          </label>
          <div className="relative">
            <MagnifyingGlass
              size={16}
              color="currentColor"
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="workspace-search"
              type="search"
              value={searchValue}
              placeholder={searchPlaceholder}
              onChange={(event) => onSearchChange(event.target.value)}
              className="h-9 border-border pl-8"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 border-border" onClick={onOpenReports}>
            <Presentation size={16} color="currentColor" aria-hidden />
            Reports
          </Button>
          <Button size="sm" className="h-9" onClick={onAdd}>
            <Plus size={16} color="currentColor" aria-hidden />
            Add
          </Button>
          <button
            type="button"
            onClick={onOpenViewer}
            className="relative flex items-center transition-opacity duration-[120ms] hover:opacity-80"
          >
            <img
              src={viewer.avatarUrl}
              alt=""
              aria-hidden
              className="ba-allow-radius size-9 rounded-full border border-border object-cover"
            />
            <span
              aria-hidden
              className={cn(
                "ba-allow-radius absolute right-0 bottom-0 size-2.5 rounded-full border border-background",
                viewer.presence === "online"
                  ? "bg-chart-2"
                  : viewer.presence === "away"
                    ? "bg-chart-3"
                    : "bg-muted-foreground",
              )}
            />
            <span className="sr-only">
              {viewer.name} ({viewer.handle}) — open your account menu
            </span>
          </button>
        </div>
      </div>

      {outcome === undefined ? null : (
        <div className="px-4 pb-3 md:px-5">
          <Outcome tone={outcome.tone}>{outcome.text}</Outcome>
        </div>
      )}
    </header>
  );
}
