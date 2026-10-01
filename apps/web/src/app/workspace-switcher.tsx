import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  refusedForNoMembership,
  useListOrganizations,
  useSwitchWorkspace,
  type SwitchedTo,
} from "@/features/auth/auth-hooks.ts";
import { noLongerAMemberOf, PICK_REFUSED, SWITCHER_UNREAD } from "@/features/auth/refusal-words.ts";
import { PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { Icon } from "@/shared/icon.tsx";
import { CONSOLE } from "@/shared/navigation.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu.tsx";

import { ALL_WORKSPACES } from "./words.ts";

/** Where the band says the person is: a workspace, or the console, which is none. */
export type Here = { readonly name: string; readonly workspaceId: string | undefined };

type Switching = ReturnType<typeof useSwitchWorkspace>;

type Listed = ReturnType<typeof useListOrganizations>;

const switchOutcome = (switching: Switching): Outcome | undefined => {
  if (switching.isPending) return { tone: "said", words: PICKER_WORDS.opening };
  const to = switching.variables;
  if (switching.error === null || to === undefined) return undefined;
  return refusedWith(
    refusedForNoMembership(switching.error) ? noLongerAMemberOf(to.name) : PICK_REFUSED,
  );
};

/** A list already held stands through a failed read of it again, so only a first read speaks. */
const listOutcome = (list: Listed): Outcome | undefined => {
  if (list.data !== undefined) return undefined;
  if (list.isFetching) return { tone: "said", words: PICKER_WORDS.reading };
  return list.isError ? refusedWith(SWITCHER_UNREAD) : undefined;
};

/**
 * Held by the frame rather than the menu, because what it says stands in the band's outcome line
 * and outlives the menu.
 */
export const useWorkspaceSwitch = () => {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState<readonly string[]>([]);
  // Read on opening alone, so a page load says nothing in the band and asks nothing of the api.
  const list = useListOrganizations(open);
  const switching = useSwitchWorkspace();

  return {
    open,
    onOpenChange: (opening: boolean) => {
      if (opening) switching.reset();
      setOpen(opening);
    },
    workspaces: (list.data ?? []).filter((workspace) => !gone.includes(workspace.id)),
    switchTo: (to: SwitchedTo) => {
      if (switching.isPending) return;
      switching.mutate(to, {
        // Left out at once, before the list is read again on the next opening.
        onError: (refused) => {
          if (refusedForNoMembership(refused)) setGone((was) => [...was, to.id]);
        },
      });
    },
    outcome: switchOutcome(switching) ?? listOutcome(list),
  };
};

type WorkspaceSwitch = ReturnType<typeof useWorkspaceSwitch>;

/**
 * The open workspace first, shown while the list is read; the rest by name, which the api never
 * orders.
 */
const listedFrom = (here: Here, workspaces: readonly SwitchedTo[]): readonly SwitchedTo[] => {
  const { workspaceId } = here;
  const others = workspaces
    .filter((workspace) => workspace.id !== workspaceId)
    .toSorted((one, other) => one.name.localeCompare(other.name, "en-GB"));
  return workspaceId === undefined ? others : [{ id: workspaceId, name: here.name }, ...others];
};

export function WorkspaceSwitcher(properties: {
  readonly here: Here;
  readonly offersTheConsole: boolean;
  readonly switching: WorkspaceSwitch;
}) {
  const { here, switching } = properties;
  const listed = listedFrom(here, switching.workspaces);

  return (
    /* Not modal: the band's outcome line speaks while the menu is open, and a modal menu would
       hide it from assistive technology. */
    <DropdownMenu modal={false} open={switching.open} onOpenChange={switching.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="min-w-0 flex-1 justify-between px-2">
          {/* Cut with an ellipsis rather than wrapped, so no name can push the toggle along. */}
          <span className="truncate font-medium text-foreground">{here.name}</span>
          <Icon name="caret-down" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-1rem)]">
        <DropdownMenuRadioGroup
          aria-label={PICKER_WORDS.heading}
          value={here.workspaceId ?? ""}
          onValueChange={(id) => {
            const to = listed.find((workspace) => workspace.id === id);
            if (to !== undefined && id !== here.workspaceId) switching.switchTo(to);
          }}
        >
          {listed.map((workspace) => (
            <DropdownMenuRadioItem key={workspace.id} value={workspace.id}>
              <span className="wrap-anywhere">{workspace.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/choose-workspace">{ALL_WORKSPACES}</Link>
        </DropdownMenuItem>
        {properties.offersTheConsole ? (
          <DropdownMenuItem asChild>
            <Link to="/console">{CONSOLE.name}</Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
