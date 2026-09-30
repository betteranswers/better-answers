import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { Button } from "@/shared/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

/** A role is a workspace's; outside one, the person has none to show. */
export type Person = {
  readonly name: string;
  readonly role?: string | undefined;
};

/** Somewhere outside this workspace, reached from the person's menu. */
export type MenuLink = {
  readonly name: string;
  readonly to: "/console" | "/choose-workspace";
};

export function TopBar(properties: {
  readonly place: string | undefined;
  readonly person: Person | undefined;
  readonly links: readonly MenuLink[];
  /** The open place's names, broadest first. */
  readonly where: readonly string[];
  readonly navigation: ReactNode;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
}) {
  const { place, person, where } = properties;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-4 py-2 md:sticky md:top-0 md:z-10 md:min-h-topbar md:flex-nowrap md:px-5">
      {/* The corner the navigation is governed from, whichever layout is in force: one place
          rather than one per breakpoint. */}
      {properties.navigation}

      {place === undefined ? null : <p className="font-medium text-foreground">{place}</p>}

      {where.length === 0 ? null : (
        // Truncated only where the row is one line: below the breakpoint it wraps instead,
        // because a clipped screen name is a reader's own place lost.
        <p className="min-w-0 flex-1 text-muted-foreground md:truncate">
          {where.map((name, index) => (
            <Fragment key={name}>
              {index === 0 ? null : <span aria-hidden> · </span>}
              <span>{name}</span>
            </Fragment>
          ))}
        </p>
      )}

      {person === undefined ? null : (
        /* Not modal: a menu button's menu never hides the rest of a page from assistive
           technology, and nothing here is trapped behind it. */
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" className="ml-auto">
              <span className="font-medium text-foreground">{person.name}</span>
              {person.role === undefined ? null : <Pill variant="outline">{person.role}</Pill>}
              <Icon name="caret-down" className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {properties.links.map((link) => (
              <DropdownMenuItem key={link.to} asChild>
                <Link to={link.to}>{link.name}</Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              disabled={properties.signingOut}
              onSelect={() => properties.onSignOut()}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}
