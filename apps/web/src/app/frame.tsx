import { Outlet, useRouterState } from "@tanstack/react-router";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useSignOut } from "@/features/auth/auth-hooks.ts";
import { useMembership } from "@/features/auth/membership.ts";
import { useOperatorStanding } from "@/features/console/operator.ts";
import { HomeLine } from "@/features/people/self-act.tsx";
import { BreadcrumbLastPartSlot } from "@/shared/breadcrumb-last-part.ts";
import { ShellKeystrokes, ShellKeystrokesAct, type Keystroke } from "@/shared/keystrokes.tsx";
import {
  EVERY_SURFACE,
  placeAt,
  readerOf,
  SURFACES,
  visibleTo,
  type Place,
  type VisibleSurface,
  type VisibleTree,
} from "@/shared/navigation.ts";
import { isFilled, type ScreenTab, type ScreenToolbar } from "@/shared/screen-toolbar.tsx";
import { useWideLayout } from "@/shared/wide-layout.ts";

import { Band, type Person } from "./band.tsx";
import { partsOf } from "./breadcrumb.tsx";
import { IconRail } from "./icon-rail.tsx";
import { JUMP_TO_KEYSTROKE, JumpTo, useJumping } from "./jump-to.tsx";
import { NavigationButton, NavigationSheet, useNavigationSheet } from "./navigation-control.tsx";
import { useSecondaryNavShowing } from "./secondary-nav-showing.ts";
import { SecondaryNav } from "./secondary-nav.tsx";
import { openTabIn, ScreenPanel, ScreenTabsRoot, Toolbar, type PickedTab } from "./toolbar.tsx";
import { useArrivalTakenOnceRead, useHidden, VisibleTreeContext } from "./visible-tree.ts";
import { useWorkspaceSwitch, WorkspaceSwitcher, type Here } from "./workspace-switcher.tsx";

type Region = { readonly name: string; readonly toolbar: ScreenToolbar };

const NO_JUMP_TO: readonly Keystroke[] = [];

const WITH_JUMP_TO: readonly Keystroke[] = [JUMP_TO_KEYSTROKE];

function FrameKeystrokes(properties: {
  readonly open: Place<VisibleSurface> | undefined;
  readonly offersJumpTo: boolean;
  readonly children: ReactNode;
}) {
  return (
    <ShellKeystrokes
      screen={properties.open?.screen.name}
      shell={properties.offersJumpTo ? WITH_JUMP_TO : NO_JUMP_TO}
    >
      {properties.children}
    </ShellKeystrokes>
  );
}

/** One source for both halves of the region, so a panel never outlives its tab list. */
const useRegion = (visible: VisibleTree, pathname: string): Region | undefined => {
  const toolbar = useRouterState({ select: (state) => state.matches.at(-1)?.staticData.toolbar });
  // The screen's own verdict, so its tabs go exactly when it does.
  const drawn = useHidden(visible, pathname) ? undefined : placeAt(EVERY_SURFACE, pathname);
  return drawn !== undefined && isFilled(toolbar)
    ? { name: drawn.screen.name, toolbar }
    : undefined;
};

/** A detail address's page names the part beneath its screen; elsewhere the open tab does. */
const belowTheScreen = (
  open: Place<VisibleSurface> | undefined,
  openTab: ScreenTab | undefined,
  lastPart: string | undefined,
): string | undefined => (open?.detail === undefined ? openTab?.name : lastPart);

/** A place hidden from the reader is no place here, so it draws as one that never existed. */
export function Frame(properties: {
  readonly visible: VisibleTree;
  /** The workspace being read, or the console in its place. */
  readonly here: Here | undefined;
  readonly person: Person | undefined;
  readonly offersTheConsole: boolean;
}) {
  const { visible, here } = properties;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { signOut, signingOut } = useSignOut();
  const wide = useWideLayout();
  const { showing, show } = useSecondaryNavShowing();
  const sheet = useNavigationSheet();
  const navId = useId();
  const switching = useWorkspaceSwitch();
  // The frame's, not the tabs root's: the band names the open tab, and the root sits below it.
  const [pickedTab, pickTab] = useState<string>();
  // Given by a page at a detail address, which alone knows whose it is.
  const [lastPart, nameLastPart] = useState<string>();
  // Once a role is held, so nothing is offered to a reader the shell cannot place.
  const offersJumpTo = visible.home !== undefined;
  const jumping = useJumping(offersJumpTo);

  const open = placeAt(visible.surfaces, pathname);
  const region = useRegion(visible, pathname);
  useArrivalTakenOnceRead(visible);

  return (
    <VisibleTreeContext value={visible}>
      <FrameKeystrokes open={open} offersJumpTo={offersJumpTo}>
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
            switcher={
              here === undefined ? null : (
                <WorkspaceSwitcher
                  here={here}
                  offersTheConsole={properties.offersTheConsole}
                  switching={switching}
                />
              )
            }
            parts={partsOf(
              open,
              belowTheScreen(open, openTabIn(region?.toolbar.tabs, pickedTab), lastPart),
            )}
            person={properties.person}
            navigation={
              <NavigationButton
                sheet={sheet}
                wide={wide}
                showing={showing}
                controls={navId}
                open={open}
                onShow={show}
              />
            }
            jumpTo={<JumpTo offered={offersJumpTo} wide={wide} tree={visible} jumping={jumping} />}
            keystrokes={<ShellKeystrokesAct at="band" />}
            signingOut={signingOut}
            onSignOut={signOut}
            outcome={switching.outcome}
          />

          <NavigationSheet sheet={sheet} wide={wide} surfaces={visible.surfaces} open={open} />

          {/*
           * A fixed rail and a 320px viewport cannot both be honoured; WCAG's reflow criterion
           * says which gives, so the navigation moves behind one button.
           */}
          <div className="flex flex-1">
            {wide ? (
              <Navigation surfaces={visible.surfaces} navId={navId} showing={showing} open={open} />
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
              <BreadcrumbLastPartSlot value={nameLastPart}>
                {/* Keyed by the workspace, so a switch draws the screen afresh over its new reads. */}
                <ToolbarAndScreen
                  key={here?.workspaceId}
                  region={region}
                  picked={[pickedTab, pickTab]}
                />
              </BreadcrumbLastPartSlot>
            </div>
          </div>
        </div>
      </FrameKeystrokes>
    </VisibleTreeContext>
  );
}

/** One frame for every workspace surface, so moving between them keeps the pressed menu button. */
export function WorkspaceFrame() {
  const membership = useMembership();
  const standing = useOperatorStanding();
  const held = membership.data;
  const role = held?.role;
  const visible = useMemo(() => visibleTo(readerOf(role), SURFACES), [role]);

  return (
    <Frame
      visible={visible}
      here={
        held === undefined
          ? undefined
          : { name: held.workspace.name, workspaceId: held.workspace.id }
      }
      person={held === undefined ? undefined : { name: held.person.name, role: held.role }}
      // Offered to the operator alone: a way in anyone else would only be refused at.
      offersTheConsole={standing.data?.operator === true}
    />
  );
}

function Navigation(properties: {
  readonly surfaces: readonly VisibleSurface[];
  readonly navId: string;
  readonly showing: boolean;
  readonly open: Place<VisibleSurface> | undefined;
}) {
  const { open } = properties;

  return (
    <>
      <IconRail
        surfaces={properties.surfaces}
        openSurfaceId={open?.surface.id}
        tooltips
        foot={<ShellKeystrokesAct at="rail" />}
      />

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

function ToolbarAndScreen(properties: {
  readonly region: Region | undefined;
  readonly picked: PickedTab;
}) {
  const { region } = properties;

  return (
    <ScreenTabsRoot tabs={region?.toolbar.tabs} picked={properties.picked}>
      {region === undefined ? null : <Toolbar name={region.name} toolbar={region.toolbar} />}

      <main id="screen" aria-label="Screen" tabIndex={-1} className="flex-1 px-4 py-6 md:px-8">
        {/* The page's width, not the prose measure: the design system's rule keeps text to it. */}
        <div data-screen-content className="max-w-page">
          <HomeLine />
          <ScreenPanel>
            <Outlet />
          </ScreenPanel>
        </div>
      </main>
    </ScreenTabsRoot>
  );
}
