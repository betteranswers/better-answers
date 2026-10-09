import { Outlet, useRouterState } from "@tanstack/react-router";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useSignOut } from "@/features/auth/auth-hooks.ts";
import { useMember } from "@/features/auth/member.ts";
import { PasskeyOffer } from "@/features/auth/passkey-offer.tsx";
import { useUnsavedChangeSaid } from "@/features/auth/unsaved-change.ts";
import { useOperatorStanding } from "@/features/console/operator.ts";
import { HomeLine } from "@/features/people/self-action.tsx";
import { GridPattern } from "@/shared/blueprint.tsx";
import { BreadcrumbLastPartSlot } from "@/shared/breadcrumb-last-part.ts";
import { ShellKeystrokes, ShellKeystrokesAction, type Keystroke } from "@/shared/keystrokes.tsx";
import {
  EVERY_AREA,
  placeAt,
  readerOf,
  AREAS,
  visibleTo,
  type Place,
  type VisibleArea,
  type VisibleTree,
} from "@/shared/navigation.ts";
import { isFilled, type PageTab, type PageToolbar } from "@/shared/page-toolbar.tsx";
import { useWideLayout } from "@/shared/wide-layout.ts";

import { Band, type Person } from "./band.tsx";
import { partsOf } from "./breadcrumb.tsx";
import { IconRail } from "./icon-rail.tsx";
import { JUMP_TO_KEYSTROKE, JumpTo, useJumping } from "./jump-to.tsx";
import { useMenuShowing } from "./menu-showing.ts";
import { Menu } from "./menu.tsx";
import { NavigationButton, NavigationSheet, useNavigationSheet } from "./navigation-control.tsx";
import { openTabIn, PagePanel, PageTabsRoot, Toolbar, type PickedTab } from "./toolbar.tsx";
import { useArrivalTakenOnceRead, useHidden, VisibleTreeContext } from "./visible-tree.ts";
import { useWorkspaceSwitch, WorkspaceSwitcher, type Here } from "./workspace-switcher.tsx";

type Region = { readonly name: string; readonly toolbar: PageToolbar };

const PAGE = "page";

const NO_JUMP_TO: readonly Keystroke[] = [];

const WITH_JUMP_TO: readonly Keystroke[] = [JUMP_TO_KEYSTROKE];

function FrameKeystrokes(properties: {
  readonly name: string | undefined;
  readonly offersJumpTo: boolean;
  readonly children: ReactNode;
}) {
  return (
    <ShellKeystrokes
      page={properties.name}
      shell={properties.offersJumpTo ? WITH_JUMP_TO : NO_JUMP_TO}
    >
      {properties.children}
    </ShellKeystrokes>
  );
}

/** One source for both halves of the region, so a panel never outlives its tab list. */
const useRegion = (visible: VisibleTree, pathname: string): Region | undefined => {
  const toolbar = useRouterState({ select: (state) => state.matches.at(-1)?.staticData.toolbar });
  // The page's own verdict, so its tabs go exactly when it does.
  const drawn = useHidden(visible, pathname) ? undefined : placeAt(EVERY_AREA, pathname);
  return drawn !== undefined && isFilled(toolbar) ? { name: drawn.page.name, toolbar } : undefined;
};

/** A page at a detail address, or at no place, names the last part; elsewhere the open tab does. */
const belowThePage = (
  open: Place<VisibleArea> | undefined,
  openTab: PageTab | undefined,
  lastPart: string | undefined,
): string | undefined =>
  open === undefined || open.detail !== undefined ? lastPart : openTab?.name;

/** A page whose route sits outside the shell, drawn in it; `name` titles its keystroke list. */
export type Handed = { readonly draw: ReactNode; readonly name?: string };

const listNameOf = (
  handed: Handed | undefined,
  open: Place<VisibleArea> | undefined,
): string | undefined => handed?.name ?? open?.page.name;

/** A place hidden from the reader is no place here, so it draws as one that never existed. */
export function Frame(properties: {
  readonly visible: VisibleTree;
  /** The workspace being read, or the console in its place. */
  readonly here: Here | undefined;
  readonly person: Person | undefined;
  readonly offersTheConsole: boolean;
  readonly page?: Handed | undefined;
}) {
  const { visible, here } = properties;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { signOut, signingOut } = useSignOut();
  const wide = useWideLayout();
  const { showing, show } = useMenuShowing();
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

  const open = placeAt(visible.areas, pathname);
  const region = useRegion(visible, pathname);
  const unsaved = useUnsavedChangeSaid(pathname);
  useArrivalTakenOnceRead(visible);

  return (
    <VisibleTreeContext value={visible}>
      <FrameKeystrokes name={listNameOf(properties.page, open)} offersJumpTo={offersJumpTo}>
        <div className="flex min-h-screen flex-col bg-background">
          <a
            href="#page"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:text-foreground"
          >
            Skip to the page
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
              belowThePage(open, openTabIn(region?.toolbar.tabs, pickedTab), lastPart),
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
            keystrokes={<ShellKeystrokesAction at="band" />}
            signingOut={signingOut}
            onSignOut={signOut}
            outcome={switching.outcome ?? unsaved}
          />

          <NavigationSheet sheet={sheet} wide={wide} areas={visible.areas} open={open} />

          {/*
           * A fixed rail and a 320px viewport cannot both be honoured; WCAG's reflow criterion
           * says which gives, so the navigation moves behind one button.
           */}
          <div className="flex flex-1">
            {wide ? (
              <Navigation areas={visible.areas} navId={navId} showing={showing} open={open} />
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
              <BreadcrumbLastPartSlot value={nameLastPart}>
                {/* Keyed by the workspace, so a switch draws the page afresh over its new reads. */}
                <ToolbarAndPage
                  key={here?.workspaceId}
                  region={region}
                  picked={[pickedTab, pickTab]}
                  handed={properties.page}
                />
              </BreadcrumbLastPartSlot>
            </div>
          </div>
        </div>
      </FrameKeystrokes>
    </VisibleTreeContext>
  );
}

/** One frame for every workspace area, so moving between them keeps the pressed menu button. */
export function WorkspaceFrame(properties: { readonly page?: Handed }) {
  const member = useMember();
  const standing = useOperatorStanding();
  const held = member.data;
  const role = held?.role;
  const visible = useMemo(() => visibleTo(readerOf(role), AREAS), [role]);

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
      page={properties.page}
    />
  );
}

function Navigation(properties: {
  readonly areas: readonly VisibleArea[];
  readonly navId: string;
  readonly showing: boolean;
  readonly open: Place<VisibleArea> | undefined;
}) {
  const { open } = properties;

  return (
    <>
      <IconRail
        areas={properties.areas}
        openAreaId={open?.area.id}
        tooltips
        foot={<ShellKeystrokesAction at="rail" />}
      />

      {open === undefined ? null : (
        <Menu
          id={properties.navId}
          showing={properties.showing}
          area={open.area}
          openPagePath={open.page.path}
        />
      )}
    </>
  );
}

function ToolbarAndPage(properties: {
  readonly region: Region | undefined;
  readonly picked: PickedTab;
  readonly handed: Handed | undefined;
}) {
  const { region } = properties;

  return (
    <PageTabsRoot tabs={region?.toolbar.tabs} picked={properties.picked}>
      <PasskeyOffer
        onDismissed={() => {
          document.getElementById(PAGE)?.focus();
        }}
      />
      {region === undefined ? null : <Toolbar name={region.name} toolbar={region.toolbar} />}

      <GridPattern>
        {/* The grid moves down by the top padding, so the page starts on one of its lines. */}
        <main
          id={PAGE}
          aria-label="Page"
          tabIndex={-1}
          className="flex-1 [background-position:0_calc(var(--spacing)*6)] px-4 py-6 md:px-8"
        >
          {/* The page's width, not the prose measure: the design system's rule keeps text to it. */}
          <div data-page-content className="max-w-page">
            <HomeLine />
            <PagePanel>
              {properties.handed === undefined ? <Outlet /> : properties.handed.draw}
            </PagePanel>
          </div>
        </main>
      </GridPattern>
    </PageTabsRoot>
  );
}
