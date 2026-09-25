import { Outlet, useRouterState } from "@tanstack/react-router";
import { useId } from "react";

import { useSignOut } from "@/features/auth/auth-hooks.ts";
import { useMembership } from "@/features/auth/membership.ts";
import { screenAt, viewAt, type Screen, type View } from "@/shared/screens.ts";
import { isFilled } from "@/shared/view-toolbar.tsx";
import { IconRail } from "./icon-rail.tsx";
import { NavigationControl } from "./navigation-control.tsx";
import { SecondaryNav } from "./secondary-nav.tsx";
import { useSecondaryNavShowing } from "./secondary-nav-showing.ts";
import { Toolbar, ViewPanel, ViewTabsRoot } from "./toolbar.tsx";
import { TopBar } from "./top-bar.tsx";
import { useWideLayout } from "./wide-layout.ts";

export function Frame() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const membership = useMembership();
  const { signOut, signingOut } = useSignOut();
  const wide = useWideLayout();
  const { showing, show } = useSecondaryNavShowing();
  const navId = useId();

  const person = membership.data;
  const openScreen = screenAt(pathname);
  const openView = viewAt(pathname);

  return (
    /*
     * A fixed rail and a 320px viewport cannot both be honoured; WCAG's reflow criterion
     * says which gives, so the navigation moves behind one button.
     */
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <a
        href="#screen"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:text-foreground"
      >
        Skip to the screen
      </a>

      {wide ? (
        <Navigation
          navId={navId}
          showing={showing}
          openScreen={openScreen}
          openViewPath={openView?.path}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          membership={
            person === undefined
              ? undefined
              : {
                  workspaceName: person.workspace.name,
                  personName: person.person.name,
                  role: person.role,
                }
          }
          screenName={openScreen?.name}
          viewName={openView?.name}
          navigation={
            <NavigationControl
              wide={wide}
              showing={showing}
              controls={navId}
              openScreen={openScreen}
              openViewPath={openView?.path}
              onShow={show}
            />
          }
          signingOut={signingOut}
          onSignOut={signOut}
        />

        <ToolbarAndScreen openView={openView} />
      </div>
    </div>
  );
}

function Navigation(properties: {
  readonly navId: string;
  readonly showing: boolean;
  readonly openScreen: Screen | undefined;
  readonly openViewPath: string | undefined;
}) {
  return (
    <>
      <IconRail openScreenId={properties.openScreen?.id} tooltips />

      {properties.openScreen === undefined ? null : (
        <SecondaryNav
          id={properties.navId}
          showing={properties.showing}
          screen={properties.openScreen}
          openViewPath={properties.openViewPath}
        />
      )}
    </>
  );
}

function ToolbarAndScreen(properties: { readonly openView: View | undefined }) {
  const { openView } = properties;
  /** The open view's own declaration, carried by its route: the shell fills nothing itself. */
  const toolbar = useRouterState({ select: (state) => state.matches.at(-1)?.staticData.toolbar });
  /** One source for both halves of the region, so a panel never outlives its tab list. */
  const region =
    openView !== undefined && isFilled(toolbar) ? { name: openView.name, toolbar } : undefined;

  return (
    <ViewTabsRoot tabs={region?.toolbar.tabs}>
      {region === undefined ? null : <Toolbar name={region.name} toolbar={region.toolbar} />}

      <main id="screen" aria-label="Screen" tabIndex={-1} className="flex-1 px-4 py-6 md:px-8">
        <div className="max-w-measure">
          <ViewPanel>
            <Outlet />
          </ViewPanel>
        </div>
      </main>
    </ViewTabsRoot>
  );
}
