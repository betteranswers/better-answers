/**
 * The toolbar with tabs: List / Kanban / Calendar / Dashboard on the left, the sort, view,
 * filter and search controls on the right.
 *
 * Registry items needed beyond the installed set: toggle-group, tooltip, separator.
 *
 * Rules that shaped it: the tab rail sits on the sunken surface (bg-muted) the register
 * reserves for headers and rails; the active tab is marked by a 2px underline and a bold
 * glyph, never by a rounded pill; the whole strip is bounded by a hairline and casts no
 * shadow. Tabs are the installed shadcn/Radix tabs, so arrow keys, Home and End work and the
 * selected tab reports `aria-selected` without any hand-rolled roles. On a narrow viewport
 * the rail scrolls horizontally and the right-hand controls collapse to icon buttons that
 * keep their accessible names.
 */
import { ChatTeardrop, Eye, Funnel, MagnifyingGlass } from "@phosphor-icons/react";

import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { WorkspaceIcon } from "@/features/workspace/workspace-icons.tsx";
import { Outcome } from "@/features/workspace/outcome.tsx";
import type {
  Identifier,
  OutcomeMessage,
  ToolbarControl,
  WorkspaceView,
} from "@/features/workspace/types.ts";

const KIND_ICON = {
  list: "clipboard",
  kanban: "chart",
  calendar: "document",
  dashboard: "pulse",
} as const;

export type ViewToolbarProps = {
  readonly views: readonly WorkspaceView[];
  readonly activeViewId: Identifier;
  readonly activeControls: readonly ToolbarControl[];
  readonly outcome?: OutcomeMessage | undefined;
  readonly onSelectView: (viewId: Identifier) => void;
  readonly onToggleControl: (control: ToolbarControl) => void;
  readonly onOpenSearch: () => void;
};

export function ViewToolbar({
  views,
  activeViewId,
  activeControls,
  outcome,
  onSelectView,
  onToggleControl,
  onOpenSearch,
}: ViewToolbarProps) {
  return (
    <div className="border-b border-border bg-muted">
      <div className="flex flex-wrap items-center gap-2 px-2 md:flex-nowrap md:px-4">
        <Tabs value={activeViewId} onValueChange={onSelectView} className="min-w-0 flex-1 gap-0">
          <TabsList
            variant="line"
            aria-label="Views"
            className="h-12 w-full justify-start gap-1 overflow-x-auto bg-transparent p-0"
          >
            {views.map((view) => {
              const active = view.id === activeViewId;
              return (
                <TabsTrigger
                  key={view.id}
                  value={view.id}
                  className={cn(
                    "h-12 shrink-0 border-b-2 border-transparent px-3 text-muted-foreground transition-colors duration-[120ms] hover:text-foreground",
                    "data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none",
                  )}
                >
                  <WorkspaceIcon name={KIND_ICON[view.kind]} active={active} />
                  {view.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <div className="flex shrink-0 items-center gap-1.5 py-2">
          <ToolbarToggle
            control="sort"
            label="Sort"
            pressed={activeControls.includes("sort")}
            onToggle={onToggleControl}
          />
          <ToolbarToggle
            control="view"
            label="View"
            pressed={activeControls.includes("view")}
            onToggle={onToggleControl}
          />
          <ToolbarToggle
            control="filter"
            label="Filter"
            pressed={activeControls.includes("filter")}
            onToggle={onToggleControl}
          />
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-9 items-center justify-center border border-border bg-background px-2.5 text-foreground transition-colors duration-[120ms] hover:bg-accent"
          >
            <MagnifyingGlass size={16} color="currentColor" aria-hidden />
            <span className="sr-only">Search in this view</span>
          </button>
        </div>
      </div>

      {outcome === undefined ? null : (
        <div className="px-4 pb-3">
          <Outcome tone={outcome.tone}>{outcome.text}</Outcome>
        </div>
      )}
    </div>
  );
}

function ToolbarToggle({
  control,
  label,
  pressed,
  onToggle,
}: {
  readonly control: ToolbarControl;
  readonly label: string;
  readonly pressed: boolean;
  readonly onToggle: (control: ToolbarControl) => void;
}) {
  const Glyph = control === "sort" ? Funnel : control === "view" ? Eye : ChatTeardrop;

  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onToggle(control)}
      className={cn(
        "flex h-9 items-center gap-2 border px-3 transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0.13,1)]",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-accent",
      )}
    >
      <Glyph size={16} color="currentColor" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  );
}
