import { Outlet, useRouterState } from "@tanstack/react-router";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { useSignOut } from "@/features/auth/auth-hooks.ts";
import { useMembership } from "@/features/auth/membership.ts";
import { useOperatorStanding } from "@/features/console/operator.ts";
import { ShellKeystrokes, ShellKeystrokesAct, type Keystroke } from "@/shared/keystrokes.tsx";
import {
  EVERY_SURFACE,
  placeAt,
  SURFACES,
  visibleTo,
  type Place,
  type VisibleSurface,
  type VisibleTree,
} from "@/shared/navigation.ts";
import { isFilled, type ScreenToolbar } from "@/shared/screen-toolbar.tsx";

import { Band, type Person } from "./band.tsx";
import { partsOf } from "./breadcrumb.tsx";
import { IconRail } from "./icon-rail.tsx";
import { JUMP_TO_KEYSTROKE, JumpTo, useJumping } from "./jump-to.tsx";
import { NavigationButton, NavigationSheet } from "./navigation-control.tsx";
import { useSecondaryNavShowing } from "./secondary-nav-showing.ts";
import { SecondaryNav } from "./secondary-nav.tsx";
import { openTabIn, ScreenPanel, ScreenTabsRoot, Toolbar, type PickedTab } from "./toolbar.tsx";
import { useHiddenOnArrival, VisibleTreeContext } from "./visible-tree.ts";
import { useWideLayout } from "./wide-layout.ts";
import { useWorkspaceSwitch, WorkspaceSwitcher, type Here } from "./workspace-switcher.tsx";

type Region = { readonly name: string; readonly toolbar: ScreenToolbar };

const NO_JUMP_TO: readonly Keystroke[] = [];

const WITH_JUMP_TO: readonly Keystroke[] = [JUMP_TO_KEYSTROKE];

/** Jump-to is offered once a role is held, and the list names only what is offered. */
function FrameKeystrokes(properties: {
  readonly open: Place | undefined;
  readonly visible: VisibleTree;
  readonly children: ReactNode;
}) {
  return (
    <ShellKeystrokes
      screen={properties.open?.screen.name}
      shell={properties.visible.home === undefined ? NO_JUMP_TO : WITH_JUMP_TO}
    >
      {properties.children}
    </ShellKeystrokes>
  );
}

/** One source for both halves of the region, so a panel never outlives its tab list. */
const useRegion = (pathname: string): Region | undefined => {
  /** The open screen's own declaration, carried by its route: the shell fills nothing itself. */
  const toolbar = useRouterState({ select: (state) => state.matches.at(-1)?.staticData.toolbar });
  // The route's own verdict, not the live tree: a role changed mid-act keeps the tabs around it.
  const drawn = useHiddenOnArrival() ? undefined : placeAt(EVERY_SURFACE, pathname);
  return drawn !== undefined && isFilled(toolbar)
    ? { name: drawn.screen.name, toolbar }
    : undefined;
};

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
  const [asked, ask] = useState(false);
  const controlRef = useRef<HTMLButtonElement | null>(null);
  const navId = useId();
  const switching = useWorkspaceSwitch();
  // The frame's, not the tabs root's: the band names the open tab, and the root sits below it.
  const picked = useState<string>();
  const jumping = useJumping(visible.home !== undefined);

  const open = placeAt(visible.surfaces, pathname);
  const region = useRegion(pathname);

  return (
    <VisibleTreeContext value={visible}>
      <FrameKeystrokes open={open} visible={visible}>
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
            parts={partsOf(open, openTabIn(region?.toolbar.tabs, picked[0])?.name)}
            person={properties.person}
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
            jumpTo={
              <JumpTo
                wide={wide}
                tree={visible}
                jumping={jumping}
                onFindMember={() => {
                  picked[1](undefined);
                }}
              />
            }
            keystrokes={<ShellKeystrokesAct at="band" />}
            signingOut={signingOut}
            onSignOut={signOut}
            outcome={switching.outcome}
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
              {/* Keyed by the workspace, so a switch draws the screen afresh over its new reads. */}
              <ToolbarAndScreen key={here?.workspaceId} region={region} picked={picked} />
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
  const visible = useMemo(() => visibleTo({ role, owns: [] }, SURFACES), [role]);

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
  readonly open: Place | undefined;
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
          <ScreenPanel>
            <Outlet />
          </ScreenPanel>
        </div>
      </main>
    </ScreenTabsRoot>
  );
}
