import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { useSignOut } from "@/features/auth/auth-hooks.ts";
import { NEEDS_A_PICK, refusalOf, useMembership } from "@/features/auth/membership.ts";
import { screenAt, viewAt } from "@/shared/screens.ts";
import { IconRail } from "./icon-rail.tsx";
import { SecondaryNav } from "./secondary-nav.tsx";
import { TopBar } from "./top-bar.tsx";

export function Frame() {
  const navigate = useNavigate();
  const here = useRouterState({ select: (state) => state.location.href });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const membership = useMembership();
  const refusal = refusalOf(membership.error);
  const { signOut, signingOut } = useSignOut();

  useEffect(() => {
    if (refusal === undefined) return;

    if (here.startsWith("/sign-in") || here.startsWith("/choose-workspace")) return;

    const to =
      refusal === NEEDS_A_PICK
        ? "/choose-workspace"
        : `/sign-in?redirect=${encodeURIComponent(here)}`;
    void navigate({ href: to, replace: true });
  }, [refusal, here, navigate]);

  const person = membership.data;
  const openScreen = screenAt(pathname);
  const openView = viewAt(pathname);

  return (
    /*
     * A fixed rail and a 320px viewport cannot both be honoured; WCAG's reflow criterion
     * says which gives, so the regions stack below this breakpoint.
     */
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <a
        href="#screen"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:text-foreground"
      >
        Skip to the screen
      </a>

      <IconRail openScreenId={openScreen?.id} />

      {openScreen === undefined ? null : (
        <SecondaryNav screen={openScreen} openViewPath={openView?.path} />
      )}

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
          signingOut={signingOut}
          onSignOut={signOut}
        />

        <main id="screen" aria-label="Screen" tabIndex={-1} className="flex-1 px-4 py-6 md:px-8">
          <div className="max-w-measure">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
