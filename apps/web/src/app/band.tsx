import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ACCOUNT_HEADING } from "@/features/auth/account-words.ts";
import { cn } from "@/shared/lib/utils.ts";
import { Logo } from "@/shared/logo.tsx";
import { initialsOf } from "@/shared/member/initials.ts";
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

export type Person = {
  readonly name: string;
  readonly role?: string | undefined;
};

type BandProperties = {
  readonly wide: boolean;
  readonly home: string;
  readonly switcher: ReactNode;
  readonly navigation: ReactNode;
  readonly jumpTo: ReactNode;
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
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BandOutcome(properties: { readonly outcome: Outcome | undefined; readonly rule: string }) {
  return (
    <div
      className={properties.outcome === undefined ? "sr-only" : cn("px-5 py-2", properties.rule)}
    >
      <OutcomeLine outcome={properties.outcome} />
    </div>
  );
}

const BAND_DRAWN_H = "--band-drawn-h";

const publishTheDrawnHeight = (band: HTMLElement) => {
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

function WideBand(properties: BandProperties) {
  return (
    <header ref={publishTheDrawnHeight} className="sticky top-0 z-10 bg-background">
      <div className="flex h-band">
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

      <BandBreadcrumb parts={properties.parts} wide={false} className="px-4 pb-2" />

      <BandOutcome outcome={properties.outcome} rule="border-t" />
    </header>
  );
}

export function Band(properties: BandProperties) {
  return properties.wide ? <WideBand {...properties} /> : <NarrowBand {...properties} />;
}
