import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { NEEDS_A_PICK, refusalOf, useMembership } from "@/features/auth/membership.ts";
import { SignOutButton } from "@/features/auth/sign-out-button.tsx";
import { SCREENS } from "@/shared/screens.ts";

export function Frame() {
  const navigate = useNavigate();
  const here = useRouterState({ select: (state) => state.location.href });
  const membership = useMembership();
  const refusal = refusalOf(membership.error);

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

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <a
        href="#screen"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:bg-card focus:px-3 focus:py-2 focus:text-foreground"
      >
        Skip to the screen
      </a>

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

        {person === undefined ? null : (
          <section aria-label="You" className="mt-auto flex flex-col gap-2 text-sm">
            <p className="font-medium text-foreground">{person.workspace.name}</p>
            <p className="text-muted-foreground">
              {person.person.name} — {person.role}
            </p>
            <div>
              <SignOutButton />
            </div>
          </section>
        )}
      </header>

      <main id="screen" tabIndex={-1} className="flex-1 px-4 py-6 md:px-8">
        <div className="max-w-measure">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
