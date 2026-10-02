import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ACCOUNT_HEADING } from "@/features/auth/account-words.ts";
import { initialsOf } from "@/shared/initials.ts";
import { cn } from "@/shared/lib/utils.ts";
import { Logo } from "@/shared/logo.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar.tsx";
import { Button } from "@/shared/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { BandBreadcrumb, type Part } from "./breadcrumb.tsx";

/** A role is a workspace's; outside one, the person has none to show. */
export type Person = {
  readonly name: string;
  readonly role?: string | undefined;
};

type BandProperties = {
  readonly wide: boolean;
  /** Where the logo leads: the person's home, or the index while their role is unread. */
  readonly home: string;
  /** Absent while the workspace is unread. */
  readonly switcher: ReactNode;
  /** The toggle when wide, the sheet's button when narrow. */
  readonly navigation: ReactNode;
  readonly jumpTo: ReactNode;
  /** Drawn by the narrow band alone: the wide one leaves it to the rail's foot. */
  readonly keystrokes: ReactNode;
  readonly parts: readonly Part[];
  readonly person: Person | undefined;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
  readonly outcome: Outcome | undefined;
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

function PersonMenu(properties: Pick<BandProperties, "person" | "signingOut" | "onSignOut">) {
  const { person } = properties;
  if (person === undefined) return null;

  return (
    /* Not modal: a menu button's menu never hides the rest of a page from assistive
       technology, and nothing here is trapped behind it. */
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="shrink-0">
          <Avatar aria-hidden className="size-7">
            <AvatarFallback className="text-xs font-medium text-foreground">
              {initialsOf(person.name)}
            </AvatarFallback>
          </Avatar>
          <span className="sr-only">{person.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel className="flex flex-col items-start gap-1.5">
          <span className="wrap-anywhere">{person.name}</span>
          {person.role === undefined ? null : <Pill variant="outline">{person.role}</Pill>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">{ACCOUNT_HEADING}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={properties.signingOut} onSelect={() => properties.onSignOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A row of its own across the band, standing hidden until it has something to say. */
function BandOutcome(properties: { readonly outcome: Outcome | undefined; readonly rule: string }) {
  return (
    <div
      hidden={properties.outcome === undefined}
      className={cn("border-border px-5 py-2", properties.rule)}
    >
      <OutcomeLine outcome={properties.outcome} />
    </div>
  );
}

const BAND_DRAWN_H = "--band-drawn-h";

/**
 * The outcome row grows the band past its token's height, so the height is measured. Declared
 * once, so React attaches it once.
 */
const publishTheDrawnHeight = (band: HTMLElement) => {
  // Where no observer is offered, the band keeps the token's height.
  if (typeof ResizeObserver === "undefined") return undefined;
  const root = document.documentElement;
  const observer = new ResizeObserver(() => {
    root.style.setProperty(BAND_DRAWN_H, `${String(band.getBoundingClientRect().height)}px`);
  });
  observer.observe(band);
  return () => {
    observer.disconnect();
    root.style.removeProperty(BAND_DRAWN_H);
  };
};

/** Each cell is as wide as the region below it, so hiding the nav moves nothing here. */
function WideBand(properties: BandProperties) {
  return (
    <header ref={publishTheDrawnHeight} className="sticky top-0 z-10 bg-background">
      <div className="flex h-band">
        {/* No rule beneath: the logo's cell and the rail read as one column. */}
        <LogoLink home={properties.home} className="w-rail border-r border-border bg-sidebar" />

        <div className="flex w-sidebar shrink-0 items-center justify-end gap-1 border-r border-b border-border px-2">
          {properties.switcher}
          {properties.navigation}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-4 border-b border-border pr-3 pl-5">
          <BandBreadcrumb parts={properties.parts} wide className="flex-1" />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {properties.jumpTo}
            <PersonMenu {...properties} />
          </div>
        </div>
      </div>

      <BandOutcome outcome={properties.outcome} rule="border-b" />
    </header>
  );
}

/** Two rows that scroll with the page: a fixed band would take a short screen's content. */
function NarrowBand(properties: BandProperties) {
  return (
    <header className="border-b border-border bg-background">
      <div className="flex h-band items-center gap-2 px-2">
        {properties.navigation}
        <LogoLink home={properties.home} className="size-8" />
        {properties.switcher}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {properties.jumpTo}
          {properties.keystrokes}
          <PersonMenu {...properties} />
        </div>
      </div>

      {/* Its own row, where it wraps rather than cut a reader's place short. */}
      <BandBreadcrumb parts={properties.parts} wide={false} className="px-4 pb-2" />

      <BandOutcome outcome={properties.outcome} rule="border-t" />
    </header>
  );
}

export function Band(properties: BandProperties) {
  return properties.wide ? <WideBand {...properties} /> : <NarrowBand {...properties} />;
}
