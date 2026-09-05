import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { NEEDS_A_PICK, refusalOf, useMembership } from "@/features/auth/membership.ts";
import { SignOutButton } from "@/features/auth/sign-out-button.tsx";
import { SCREENS } from "@/shared/screens.ts";

/**
 * Control Centre's frame: the `better-answers` handle, who the platform thinks is reading
 * and where, the navigation over the six screens, and the region a screen renders into.
 *
 * The shell names the workspace, the person and their role because a person must never act
 * in the wrong workspace or under a role they do not have (user stories 9 and 10). All
 * three come from one read through the platform's own resolver, so what the shell says is
 * what the next call will be allowed to do — and when that read is refused, the shell does
 * not guess: it sends the person where the refusal says, keeping the address they were
 * reading so they come back to it.
 *
 * WCAG 2.2 AA, tested with a keyboard and a screen reader: three landmarks
 * (banner, navigation, main), a skip link as the first thing in the tab order, the DOM
 * order as the keyboard order, the current screen marked with `aria-current`, and the
 * focus ring the design system's bridge draws on every focusable element.
 */
export function Frame() {
  const navigate = useNavigate();
  const here = useRouterState({ select: (state) => state.location.href });
  const membership = useMembership();
  const refusal = refusalOf(membership.error);

  useEffect(() => {
    if (refusal === undefined) return;
    // The shell can still be mounted for a moment while the router moves away from it, and
    // without this the effect would fold the address it is already leaving into the next
    // redirect — once per frame, until the address is a hundred nested sign-ins long.
    if (here.startsWith("/sign-in") || here.startsWith("/choose-workspace")) return;
    // A session that has not picked a workspace has a question to answer, not a sign-in
    // to repeat. Everything else — no session, a revoked credential, a membership that
    // has ended — is answered by signing in again, and the address being read is carried
    // so the person is returned to it (user story 8).
    const to =
      refusal === NEEDS_A_PICK
        ? "/choose-workspace"
        : `/sign-in?redirect=${encodeURIComponent(here)}`;
    void navigate({ href: to, replace: true });
  }, [refusal, here, navigate]);

  const person = membership.data;

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <a
        href="#screen"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:bg-card focus:px-3 focus:py-2 focus:text-foreground"
      >
        Skip to the screen
      </a>

      {/*
        Stacked below the medium breakpoint, beside the screen above it. A 248px rail and a
        320px viewport cannot both be honoured, and WCAG 2.2 AA's reflow criterion says
        which one gives.
      */}
      <header className="flex shrink-0 flex-col gap-6 border-b border-border bg-sidebar px-4 py-5 md:w-sidebar md:border-r md:border-b-0">
        <p className="font-mono font-medium tracking-tight text-foreground">better-answers</p>

        <nav aria-label="Control Centre">
          <ul className="flex flex-col gap-1">
            {SCREENS.map((screen) => (
              <li key={screen.id}>
                <Link
                  to={screen.path}
                  className="block px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  activeProps={{
                    className:
                      "block px-2 py-1.5 bg-accent text-accent-foreground font-medium hover:bg-accent",
                    "aria-current": "page",
                  }}
                >
                  {screen.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/*
          The workspace first, because it is the thing a person can be wrong about with the
          worst consequence; then who they are here, and at what role. Nothing is shown
          until it is known: a shell that guessed would be saying something it cannot know.
        */}
        {person === undefined ? null : (
          <section aria-label="You" className="mt-auto flex flex-col gap-2 text-sm">
            <p className="font-medium text-foreground">{person.workspace.name}</p>
            <p className="text-muted-foreground">
              {person.person.name ?? person.person.email} — {person.role}
            </p>
            <div>
              <SignOutButton />
            </div>
          </section>
        )}
      </header>

      {/*
        `tabIndex={-1}` is what makes the skip link move focus as well as the viewport: a
        <main> is not focusable by default, so the link would scroll and leave the next tab
        stop back in the navigation.
      */}
      <main id="screen" tabIndex={-1} className="flex-1 px-4 py-6 md:px-8">
        <div className="max-w-measure">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
