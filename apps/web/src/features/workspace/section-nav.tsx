/**
 * Region two of the workspace shell: the toggleable secondary nav that swaps per section.
 *
 * Registry items needed beyond the installed set: separator, scroll-area, tooltip.
 * (Rendered here with hairline rules and a native overflow region so the block compiles
 * against the installed set; swap them in without changing the markup's shape.)
 *
 * It carries the workspace switcher, the panel toggle, the section's flat items, and the
 * collapsible groups with their optional "+". Rule that shaped it: every radius is 0 and the
 * only tinted surface is a hover step or the selected item — no shadow, no lift. The nav is
 * a real <nav> with a real list, the switcher is a menu button, and the toggle reports
 * `aria-expanded`/`aria-controls`, so the keyboard order is the DOM order.
 */
import { useId } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { WorkspaceIcon } from "@/features/workspace/workspace-icons.tsx";
import { Outcome } from "@/features/workspace/outcome.tsx";
import type {
  Identifier,
  NavGroup,
  NavItem,
  OutcomeMessage,
  SectionNav as SectionNavModel,
  Workspace,
} from "@/features/workspace/types.ts";
import { CaretDown, CaretUpDown, Lightning, Plus, SidebarSimple } from "@phosphor-icons/react";

export type SectionNavProps = {
  readonly workspace: Workspace;
  readonly workspaces: readonly Workspace[];
  readonly nav: SectionNavModel;
  readonly activeItemId: Identifier;
  readonly open: boolean;
  readonly outcome?: OutcomeMessage | undefined;
  readonly onToggleOpen: () => void;
  readonly onSelectWorkspace: (workspaceId: Identifier) => void;
  readonly onSelectItem: (itemId: Identifier) => void;
  readonly onCreateInGroup: (groupId: Identifier) => void;
};

export function SectionNav({
  workspace,
  workspaces,
  nav,
  activeItemId,
  open,
  outcome,
  onToggleOpen,
  onSelectWorkspace,
  onSelectItem,
  onCreateInGroup,
}: SectionNavProps) {
  const panelId = useId();

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-border bg-background md:border-r",
        open ? "w-full md:w-[304px]" : "w-full md:w-auto",
      )}
    >
      <div className="flex h-15 items-center gap-2 border-b border-border px-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left transition-colors duration-[120ms] hover:bg-accent",
              open ? "" : "md:hidden",
            )}
          >
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center bg-brand text-brand-foreground"
            >
              <Lightning size={16} color="currentColor" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {workspace.name}
            </span>
            <CaretUpDown
              size={16}
              color="currentColor"
              aria-hidden
              className="text-muted-foreground"
            />
            <span className="sr-only">Switch workspace — current: {workspace.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-[11px] tracking-[0.06em] uppercase text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {workspaces.map((candidate) => (
              <DropdownMenuItem
                key={candidate.id}
                onSelect={() => onSelectWorkspace(candidate.id)}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="font-medium text-foreground">{candidate.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {candidate.slug} · {candidate.plan}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggleOpen}
          className="flex size-8 items-center justify-center border border-border text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-accent-foreground"
        >
          <SidebarSimple size={16} color="currentColor" aria-hidden />
          <span className="sr-only">
            {open ? "Hide the section navigation" : "Show the section navigation"}
          </span>
        </button>
      </div>

      <div
        id={panelId}
        hidden={!open}
        className="flex-1 overflow-y-auto px-3 py-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      >
        <nav aria-label="Section">
          <ul className="flex flex-col">
            {nav.items.map((item) => (
              <NavRow
                key={item.id}
                item={item}
                active={item.id === activeItemId}
                onSelect={onSelectItem}
              />
            ))}
          </ul>

          {nav.groups.map((group) => (
            <NavGroupBlock
              key={group.id}
              group={group}
              activeItemId={activeItemId}
              onSelectItem={onSelectItem}
              onCreateInGroup={onCreateInGroup}
            />
          ))}
        </nav>

        {outcome === undefined ? null : <Outcome tone={outcome.tone}>{outcome.text}</Outcome>}
      </div>
    </div>
  );
}

function NavGroupBlock({
  group,
  activeItemId,
  onSelectItem,
  onCreateInGroup,
}: {
  readonly group: NavGroup;
  readonly activeItemId: Identifier;
  readonly onSelectItem: (itemId: Identifier) => void;
  readonly onCreateInGroup: (groupId: Identifier) => void;
}) {
  return (
    <Collapsible defaultOpen={group.defaultOpen} className="mt-3 border-t border-border pt-3">
      <div className="flex items-center gap-1 pr-1 pl-2">
        <h2 className="flex-1 text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">
          {group.label}
        </h2>
        {group.canCreate ? (
          <button
            type="button"
            onClick={() => onCreateInGroup(group.id)}
            className="flex size-6 items-center justify-center text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-accent-foreground"
          >
            <Plus size={16} color="currentColor" aria-hidden />
            <span className="sr-only">Add to {group.label}</span>
          </button>
        ) : null}
        <CollapsibleTrigger className="group flex size-6 items-center justify-center bg-muted text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-accent-foreground">
          <CaretDown
            size={16}
            color="currentColor"
            aria-hidden
            className="transition-transform duration-[160ms] group-data-[state=closed]:-rotate-90"
          />
          <span className="sr-only">Toggle {group.label}</span>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="overflow-hidden motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in motion-safe:data-[state=open]:duration-200">
        <ul className="mt-1 flex flex-col">
          {group.items.map((item) => (
            <NavRow
              key={item.id}
              item={item}
              active={item.id === activeItemId}
              onSelect={onSelectItem}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NavRow({
  item,
  active,
  onSelect,
}: {
  readonly item: NavItem;
  readonly active: boolean;
  readonly onSelect: (itemId: Identifier) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(item.id)}
        className={cn(
          "flex w-full items-center gap-3 px-2 py-2 text-left transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0.13,1)]",
          active
            ? "bg-accent font-medium text-accent-foreground"
            : "text-foreground hover:bg-accent",
        )}
      >
        <span className="text-muted-foreground">
          <WorkspaceIcon name={item.icon} />
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.handle === undefined ? null : (
          <span className="font-mono text-xs text-muted-foreground">{item.handle}</span>
        )}
        {item.tone === undefined ? null : <NavTag tone={item.tone} />}
      </button>
    </li>
  );
}

function NavTag({ tone }: { readonly tone: "beta" | "pro" }) {
  return (
    <span
      className={cn(
        "border px-1.5 py-0.5 text-[11px] font-medium tracking-[0.06em] uppercase",
        tone === "beta"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-brand/30 bg-brand/10 text-brand",
      )}
    >
      {tone}
    </span>
  );
}
