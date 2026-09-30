import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { Logo } from "@/shared/logo.tsx";
import { Button } from "@/shared/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { PRODUCT_NAME } from "@/shared/words.ts";

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

type BandProperties = {
  readonly wide: boolean;
  /** Where the logo leads: the person's home, or the index while their role is unread. */
  readonly home: string;
  /** The workspace being read, or the console in its place. */
  readonly place: string | undefined;
  /** The open place's names, broadest first. */
  readonly where: readonly string[];
  readonly person: Person | undefined;
  readonly links: readonly MenuLink[];
  /** The toggle when wide, the sheet's button when narrow. */
  readonly navigation: ReactNode;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
};

function LogoLink(properties: { readonly home: string; readonly className: string }) {
  return (
    <Link
      to={properties.home}
      className={cn(
        "flex shrink-0 items-center justify-center text-foreground",
        properties.className,
      )}
    >
      <Logo />
      <span className="sr-only">{PRODUCT_NAME}</span>
    </Link>
  );
}

/** Cut with an ellipsis rather than wrapped, so no name can push the toggle along. */
function WorkspaceName(properties: { readonly place: string | undefined }) {
  if (properties.place === undefined) return null;
  return <p className="min-w-0 flex-1 truncate font-medium text-foreground">{properties.place}</p>;
}

function PlaceLine(properties: { readonly where: readonly string[]; readonly className: string }) {
  const { where } = properties;
  if (where.length === 0) return null;

  return (
    <p className={cn("min-w-0 text-muted-foreground", properties.className)}>
      {where.map((name, index) => (
        <Fragment key={name}>
          {index === 0 ? null : <span aria-hidden> / </span>}
          <span className={index === where.length - 1 ? "text-foreground" : undefined}>{name}</span>
        </Fragment>
      ))}
    </p>
  );
}

function PersonMenu(
  properties: Pick<BandProperties, "person" | "links" | "signingOut" | "onSignOut">,
) {
  const { person } = properties;
  if (person === undefined) return null;

  return (
    /* Not modal: a menu button's menu never hides the rest of a page from assistive
       technology, and nothing here is trapped behind it. */
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="max-w-full min-w-0">
          <span className="truncate font-medium text-foreground">{person.name}</span>
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
        <DropdownMenuItem disabled={properties.signingOut} onSelect={() => properties.onSignOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Each cell is as wide as the region below it, so hiding the nav moves nothing here. */
function WideBand(properties: BandProperties) {
  return (
    <header className="sticky top-0 z-10 flex h-topbar bg-background">
      {/* No rule beneath: the logo's cell and the rail read as one column. */}
      <LogoLink home={properties.home} className="w-rail border-r border-border bg-sidebar" />

      <div className="flex w-sidebar shrink-0 items-center justify-end gap-2 border-r border-b border-border pr-2 pl-4">
        <WorkspaceName place={properties.place} />
        {properties.navigation}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-4 border-b border-border pr-3 pl-5">
        <PlaceLine where={properties.where} className="flex-1 truncate" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PersonMenu {...properties} />
        </div>
      </div>
    </header>
  );
}

/** Two rows that scroll with the page: a fixed band would take a short screen's content. */
function NarrowBand(properties: BandProperties) {
  return (
    <header className="border-b border-border bg-background">
      <div className="flex h-topbar items-center gap-2 px-2">
        {properties.navigation}
        <LogoLink home={properties.home} className="size-8" />
        <WorkspaceName place={properties.place} />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <PersonMenu {...properties} />
        </div>
      </div>

      {/* Its own row, where it wraps rather than cut a reader's place short. */}
      <PlaceLine where={properties.where} className="px-4 pb-2" />
    </header>
  );
}

export function Band(properties: BandProperties) {
  return properties.wide ? <WideBand {...properties} /> : <NarrowBand {...properties} />;
}
