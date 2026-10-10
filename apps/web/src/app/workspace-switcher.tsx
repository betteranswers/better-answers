import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  useSwitchWorkspace,
  useWorkspacesHeld,
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
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { ALL_WORKSPACES } from "./words.ts";

/**
 * Where the band says the person is: a workspace and their role in it, or the console, which is
 * none.
 */
export type Here = {
  readonly name: string;
  readonly workspaceId: string | undefined;
  readonly role?: string | undefined;
};

type Switching = ReturnType<typeof useSwitchWorkspace>;

type ListRead = ReturnType<typeof useWorkspacesHeld>;

/** A workspace as the menu lists it, with the person's role there. */
type Listed = SwitchedTo & { readonly role: string | undefined };

const switchOutcome = (switching: Switching): Outcome | undefined => {
  if (switching.isPending) return { tone: "said", words: PICKER_WORDS.opening };
  const to = switching.variables;
  if (switching.error === null || to === undefined) return undefined;
  return refusedWith(switching.error.noLongerAMember ? noLongerAMemberOf(to.name) : PICK_REFUSED);
};

/** A list already held stands through a failed read of it again, so only a first read speaks. */
const listOutcome = (list: ListRead): Outcome | undefined => {
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
  const list = useWorkspacesHeld(open);
  const switching = useSwitchWorkspace();
  const workspaces: readonly Listed[] = (list.data ?? []).filter(
    (workspace) => !gone.includes(workspace.id),
  );

  return {
    open,
    onOpenChange: (opening: boolean) => {
      // A reset lets go of a pending switch without stopping it, so its refusal would go unsaid.
      if (opening && !switching.isPending) switching.reset();
      setOpen(opening);
    },
    pending: switching.isPending,
    workspaces,
    switchTo: (to: SwitchedTo) => {
      if (switching.isPending) return;
      switching.mutate(to, {
        // Left out at once, before the list is read again on the next opening.
        onError: (refused) => {
          if (refused.noLongerAMember) setGone((was) => [...was, to.id]);
        },
      });
    },
    outcome: switchOutcome(switching) ?? listOutcome(list),
  };
};

type WorkspaceSwitch = ReturnType<typeof useWorkspaceSwitch>;

/**
 * The open workspace first, from what the frame holds, so it shows while the list is read; the
 * rest by name.
 */
const listedFrom = (here: Here, workspaces: readonly Listed[]): readonly Listed[] => {
  const { workspaceId } = here;
  const others = workspaces
    .filter((workspace) => workspace.id !== workspaceId)
    .toSorted((one, other) => one.name.localeCompare(other.name, "en-GB"));
  return workspaceId === undefined
    ? others
    : [{ id: workspaceId, name: here.name, role: here.role }, ...others];
};

/**
 * Held while a switch is pending, since its late answer would move whatever page the person
 * left for.
 */
function WayOut(properties: {
  readonly to: "/choose-workspace" | "/console";
  readonly held: boolean;
  readonly children: string;
}) {
  return (
    <DropdownMenuItem asChild disabled={properties.held}>
      {/* The item's hold stops the pointer and the keys, not the link's own click. */}
      <Link
        to={properties.to}
        onClick={(event) => {
          if (properties.held) event.preventDefault();
        }}
      >
        {properties.children}
      </Link>
    </DropdownMenuItem>
  );
}

/** Inside the item, after the name, so a person reads where they hold which role. */
function RoleTag(properties: { readonly role: string | undefined }) {
  if (properties.role === undefined) return null;
  return (
    <Pill variant="outline" className="ml-auto px-2 py-0.5">
      {properties.role}
    </Pill>
  );
}

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
          {/* Held while a switch is pending, which the band's outcome line names. */}
          {listed.map((workspace) => (
            <DropdownMenuRadioItem
              key={workspace.id}
              value={workspace.id}
              disabled={switching.pending}
            >
              <span className="wrap-anywhere">{workspace.name}</span>{" "}
              <RoleTag role={workspace.role} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <WayOut to="/choose-workspace" held={switching.pending}>
          {ALL_WORKSPACES}
        </WayOut>
        {properties.offersTheConsole ? (
          <WayOut to="/console" held={switching.pending}>
            {CONSOLE.name}
          </WayOut>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
