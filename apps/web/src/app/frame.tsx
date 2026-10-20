import { Outlet, useRouterState } from "@tanstack/react-router";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useSignOut } from "@/features/auth/auth-hooks.ts";
import { PasskeyOffer, useOfferPlace, type OfferPlace } from "@/features/auth/passkey-offer.tsx";
import { saidOfASignOutRefused } from "@/features/auth/refusal-words.ts";
import { useSwitchedElsewhereSaid } from "@/features/auth/switched-elsewhere.ts";
import { useUnsavedChangeSaid } from "@/features/auth/unsaved-change.ts";
import { useOperatorStanding } from "@/features/console/operator.ts";
import { HomeLine } from "@/features/people/self-action.tsx";
import { GridPattern } from "@/shared/blueprint.tsx";
import { BreadcrumbLastPartSlot } from "@/shared/breadcrumb-last-part.ts";
import { ShellKeystrokes, ShellKeystrokesAction, type Keystroke } from "@/shared/keystrokes.tsx";
import { leftFor, useMember } from "@/shared/member.ts";
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
import type { Outcome } from "@/shared/outcome.tsx";
import { PageHeadSlot } from "@/shared/page-head.tsx";
import { isFilled, type PageTab, type PageToolbar } from "@/shared/page-toolbar.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
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
import { switchedInAnotherTab } from "./words.ts";
import {
  useWorkspaceSwitch,
  WorkspaceSwitcher,
  type Here,
  type WorkspaceSwitch,
} from "./workspace-switcher.tsx";

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

const useRegion = (visible: VisibleTree, pathname: string): Region | undefined => {
  const toolbar = useRouterState({ select: (state) => state.matches.at(-1)?.staticData.toolbar });
  const drawn = useHidden(visible, pathname) ? undefined : placeAt(EVERY_AREA, pathname);
  return drawn !== undefined && isFilled(toolbar) ? { name: drawn.page.name, toolbar } : undefined;
};

const belowThePage = (
  open: Place<VisibleArea> | undefined,
  openTab: PageTab | undefined,
  lastPart: string | undefined,
): string | undefined =>
  open === undefined || open.detail !== undefined ? lastPart : openTab?.name;

export type Handed = { readonly draw: ReactNode; readonly name?: string };

const listNameOf = (
  handed: Handed | undefined,
  open: Place<VisibleArea> | undefined,
): string | undefined => handed?.name ?? open?.page.name;

const useSwitchedInAnotherTabSaid = (here: Here | undefined): Outcome | undefined => {
  const entry = useRouterState({ select: (state) => state.location.state.__TSR_key });
  const now = here?.workspaceId;
  const [held, setHeld] = useState(now);
  const [saidAt, setSaidAt] = useState<string>();
  if (now !== held) {
    setHeld(now);
    setSaidAt(leftFor(held, now) ? entry : undefined);
  }
  return here !== undefined && saidAt !== undefined && saidAt === entry
    ? { tone: "said", words: switchedInAnotherTab(here.name) }
    : undefined;
};

const useSwitchesSeen = (now: string | undefined): number => {
  const [seen, setSeen] = useState({ in: now, switches: 0 });
  if (now !== undefined && now !== seen.in) {
    setSeen({ in: now, switches: seen.switches + (leftFor(seen.in, now) ? 1 : 0) });
  }
  return seen.switches;
};

type SaidOn = { readonly failure: Error | null; readonly pathname: string | undefined };

const useSignOutRefusedSaid = (failure: Error | null, pathname: string): Outcome | undefined => {
  const [said, setSaid] = useState<SaidOn>({ failure, pathname });
  if (failure !== said.failure) setSaid({ failure, pathname });
  else if (said.pathname !== undefined && said.pathname !== pathname) {
    setSaid({ failure, pathname: undefined });
  }
  return failure !== null && said.pathname === pathname
    ? refusedWith(saidOfASignOutRefused(failure))
    : undefined;
};

type Leaving = ReturnType<typeof useSignOut>;

const useBandOutcome = (
  switching: WorkspaceSwitch,
  leaving: Leaving,
  here: Here | undefined,
  pathname: string,
): Outcome | undefined => {
  const refusedSigningOut = useSignOutRefusedSaid(leaving.failure, pathname);
  const refusedElsewhere = useSwitchedElsewhereSaid();
  const readElsewhere = useSwitchedInAnotherTabSaid(switching.pending ? undefined : here);
  const unsaved = useUnsavedChangeSaid(pathname);
  return refusedSigningOut ?? switching.outcome ?? refusedElsewhere ?? readElsewhere ?? unsaved;
};

export function Frame(properties: {
  readonly visible: VisibleTree;
  readonly here: Here | undefined;
  readonly person: Person | undefined;
  readonly offersTheConsole: boolean;
  readonly page?: Handed | undefined;
}) {
  const { visible, here } = properties;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const leaving = useSignOut();
  const wide = useWideLayout();
  const { showing, show } = useMenuShowing();
  const sheet = useNavigationSheet();
  const navId = useId();
  const switching = useWorkspaceSwitch();
  const [pickedTab, pickTab] = useState<string>();
  const [lastPart, nameLastPart] = useState<string>();
  const offerPlace = useOfferPlace();
  const offersJumpTo = visible.home !== undefined;
  const jumping = useJumping(offersJumpTo);

  const open = placeAt(visible.areas, pathname);
  const region = useRegion(visible, pathname);
  const outcome = useBandOutcome(switching, leaving, here, pathname);
  const switches = useSwitchesSeen(here?.workspaceId);
  useArrivalTakenOnceRead(visible);

  return (
    <VisibleTreeContext value={visible}>
      <FrameKeystrokes name={listNameOf(properties.page, open)} offersJumpTo={offersJumpTo}>
        <div className="flex min-h-screen flex-col bg-background">
          <a
            href="#page"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:text-foreground"
          >
            Skip to the Page
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
            signingOut={leaving.signingOut}
            onSignOut={leaving.signOut}
            outcome={outcome}
          />

          <NavigationSheet sheet={sheet} wide={wide} areas={visible.areas} open={open} />

          <div className="flex flex-1">
            {wide ? (
              <Navigation areas={visible.areas} navId={navId} showing={showing} open={open} />
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
              <BreadcrumbLastPartSlot value={nameLastPart}>
                <ToolbarAndPage
                  key={switches}
                  region={region}
                  picked={[pickedTab, pickTab]}
                  handed={properties.page}
                  offerPlace={offerPlace}
                />
              </BreadcrumbLastPartSlot>
            </div>
          </div>
        </div>
      </FrameKeystrokes>
    </VisibleTreeContext>
  );
}

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
          : { name: held.workspace.name, workspaceId: held.workspace.id, role: held.role }
      }
      person={held === undefined ? undefined : { name: held.person.name, role: held.role }}
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
  readonly offerPlace: OfferPlace;
}) {
  const { region } = properties;
  const [headSlot, holdHeadSlot] = useState<HTMLElement | null>(null);

  return (
    <PageTabsRoot tabs={region?.toolbar.tabs} picked={properties.picked}>
      <PasskeyOffer
        place={properties.offerPlace}
        onDismissed={() => {
          document.getElementById(PAGE)?.focus();
        }}
      />

      <GridPattern>
        <main
          id={PAGE}
          aria-label="Page"
          tabIndex={-1}
          className="flex-1 [background-position:0_calc(var(--spacing)*6)] px-4 py-6 md:px-8"
        >
          <div data-page-content className="max-w-page">
            <HomeLine />
            <div ref={holdHeadSlot} />
            {region === undefined ? null : <Toolbar name={region.name} toolbar={region.toolbar} />}
            <PageHeadSlot value={headSlot}>
              <PagePanel>
                {properties.handed === undefined ? <Outlet /> : properties.handed.draw}
              </PagePanel>
            </PageHeadSlot>
          </div>
        </main>
      </GridPattern>
    </PageTabsRoot>
  );
}
