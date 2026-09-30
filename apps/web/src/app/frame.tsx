import { Outlet, useRouterState } from "@tanstack/react-router";
import { useId, useMemo, useRef, useState } from "react";

import { useSignOut } from "@/features/auth/auth-hooks.ts";
import { useMembership } from "@/features/auth/membership.ts";
import { useOperatorStanding } from "@/features/console/operator.ts";
import {
  EVERY_SURFACE,
  placeAt,
  SURFACES,
  visibleTo,
  type Place,
  type VisibleSurface,
  type VisibleTree,
} from "@/shared/navigation.ts";
import { isFilled } from "@/shared/screen-toolbar.tsx";

import { Band, type MenuLink, type Person } from "./band.tsx";
import { IconRail } from "./icon-rail.tsx";
import { NavigationButton, NavigationSheet } from "./navigation-control.tsx";
import { useSecondaryNavShowing } from "./secondary-nav-showing.ts";
import { SecondaryNav } from "./secondary-nav.tsx";
import { ScreenPanel, ScreenTabsRoot, Toolbar } from "./toolbar.tsx";
import { useHiddenOnArrival, VisibleTreeContext } from "./visible-tree.ts";
import { useWideLayout } from "./wide-layout.ts";

const TO_THE_CONSOLE: MenuLink = { name: "Console", to: "/console" };

/** Surface, group and screen, broadest first, with no name said twice. */
const namesOf = (open: Place | undefined): readonly string[] =>
  open === undefined
    ? []
    : [
        ...new Set(
          [open.surface.name, open.group?.name, open.screen.name].filter(
            (name): name is string => name !== undefined,
          ),
        ),
      ];

/** A place hidden from the reader is no place here, so it draws as one that never existed. */
export function Frame(properties: {
  readonly visible: VisibleTree;
  readonly place: string | undefined;
  readonly person: Person | undefined;
  readonly links: readonly MenuLink[];
}) {
  const { visible } = properties;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { signOut, signingOut } = useSignOut();
  const wide = useWideLayout();
  const { showing, show } = useSecondaryNavShowing();
  const [asked, ask] = useState(false);
  const controlRef = useRef<HTMLButtonElement | null>(null);
  const navId = useId();

  const open = placeAt(visible.surfaces, pathname);
  // The route's own verdict, not the live tree: a role changed mid-act keeps the tabs around it.
  const drawn = useHiddenOnArrival() ? undefined : placeAt(EVERY_SURFACE, pathname);

  return (
    <VisibleTreeContext value={visible}>
      <div className="flex min-h-screen flex-col bg-background">
        <a
          href="#screen"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:text-foreground"
        >
          Skip to the screen
        </a>

        <Band
          wide={wide}
          home={visible.home?.path ?? "/"}
          place={properties.place}
          where={namesOf(open)}
          person={properties.person}
          links={properties.links}
          navigation={
            <NavigationButton
              controlRef={controlRef}
              wide={wide}
              asked={asked}
              onAsk={ask}
              showing={showing}
              controls={navId}
              open={open}
              onShow={show}
            />
          }
          signingOut={signingOut}
          onSignOut={signOut}
        />

        <NavigationSheet
          controlRef={controlRef}
          wide={wide}
          asked={asked}
          onAsk={ask}
          surfaces={visible.surfaces}
          open={open}
        />

        {/*
         * A fixed rail and a 320px viewport cannot both be honoured; WCAG's reflow criterion
         * says which gives, so the navigation moves behind one button.
         */}
        <div className="flex flex-1">
          {wide ? (
            <Navigation surfaces={visible.surfaces} navId={navId} showing={showing} open={open} />
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <ToolbarAndScreen screenName={drawn?.screen.name} />
          </div>
        </div>
      </div>
    </VisibleTreeContext>
  );
}

/** One frame for every workspace surface, so moving between them keeps the pressed menu button. */
export function WorkspaceFrame() {
  const membership = useMembership();
  const standing = useOperatorStanding();
  const held = membership.data;
  const role = held?.role;
  const visible = useMemo(() => visibleTo({ role, owns: [] }, SURFACES), [role]);

  return (
    <Frame
      visible={visible}
      place={held?.workspace.name}
      person={held === undefined ? undefined : { name: held.person.name, role: held.role }}
      // Shown to the operator alone: a link anyone else would only be refused at.
      links={standing.data?.operator === true ? [TO_THE_CONSOLE] : []}
    />
  );
}

function Navigation(properties: {
  readonly surfaces: readonly VisibleSurface[];
  readonly navId: string;
  readonly showing: boolean;
  readonly open: Place | undefined;
}) {
  const { open } = properties;

  return (
    <>
      <IconRail surfaces={properties.surfaces} openSurfaceId={open?.surface.id} tooltips />

      {open === undefined ? null : (
        <SecondaryNav
          id={properties.navId}
          showing={properties.showing}
          surface={open.surface}
          openScreenPath={open.screen.path}
        />
      )}
    </>
  );
}

function ToolbarAndScreen(properties: { readonly screenName: string | undefined }) {
  const { screenName } = properties;
  /** The open screen's own declaration, carried by its route: the shell fills nothing itself. */
  const toolbar = useRouterState({ select: (state) => state.matches.at(-1)?.staticData.toolbar });
  /** One source for both halves of the region, so a panel never outlives its tab list. */
  const region =
    screenName !== undefined && isFilled(toolbar) ? { name: screenName, toolbar } : undefined;

  return (
    <ScreenTabsRoot tabs={region?.toolbar.tabs}>
      {region === undefined ? null : <Toolbar name={region.name} toolbar={region.toolbar} />}

      <main id="screen" aria-label="Screen" tabIndex={-1} className="flex-1 px-4 py-6 md:px-8">
        {/* The page's width, not the prose measure: the design system's rule keeps text to it. */}
        <div data-screen-content className="max-w-page">
          <ScreenPanel>
            <Outlet />
          </ScreenPanel>
        </div>
      </main>
    </ScreenTabsRoot>
  );
}
