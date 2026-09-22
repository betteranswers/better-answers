import type { ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { Badge } from "@/shared/ui/badge.tsx";
import { Button } from "@/shared/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu.tsx";

export type Membership = {
  readonly workspaceName: string;
  readonly personName: string;
  readonly role: string;
};

export function TopBar(properties: {
  readonly membership: Membership | undefined;
  readonly screenName: string | undefined;
  readonly viewName: string | undefined;
  readonly navigation: ReactNode;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
}) {
  const { membership, screenName, viewName } = properties;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-4 py-2 md:sticky md:top-0 md:z-10 md:min-h-topbar md:flex-nowrap md:px-5">
      {/* The corner the navigation is governed from, whichever layout is in force: one place
          rather than one per breakpoint. */}
      {properties.navigation}

      {membership === undefined ? null : (
        <p className="font-medium text-foreground">{membership.workspaceName}</p>
      )}

      {screenName === undefined ? null : (
        // Truncated only where the row is one line: below the breakpoint it wraps instead,
        // because a clipped view name is a reader's own place lost.
        <p className="min-w-0 flex-1 text-muted-foreground md:truncate">
          <span>{screenName}</span>
          {viewName === undefined ? null : (
            <>
              <span aria-hidden> · </span>
              <span>{viewName}</span>
            </>
          )}
        </p>
      )}

      {membership === undefined ? null : (
        /* Not modal: a menu button's menu never hides the rest of a page from assistive
           technology, and nothing here is trapped behind it. */
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" className="ml-auto">
              <span className="font-medium text-foreground">{membership.personName}</span>
              <Badge variant="outline">{membership.role}</Badge>
              <Icon name="caret-down" className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
