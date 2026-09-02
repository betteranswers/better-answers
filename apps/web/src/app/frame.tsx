import { Link, Outlet } from "@tanstack/react-router";

import { SCREENS } from "../shared/screens.ts";

/**
 * Control Centre's frame: the `better-answers` handle, the navigation over the six
 * screens, and the region a screen renders into.
 *
 * Nothing here names a workspace or a person. The frame renders without a session and
 * says nothing about who is signed in, because signing in is a later ticket and a shell
 * that guessed would be saying something it cannot know.
 *
 * WCAG 2.2 AA, tested with a keyboard and a screen reader (`[A11Y1]`): three landmarks
 * (banner, navigation, main), a skip link as the first thing in the tab order, the DOM
 * order as the keyboard order, the current screen marked with `aria-current`, and the
 * focus ring the design system's bridge draws on every focusable element.
 */
export function Frame() {
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
        which one gives (`[A11Y1]`).
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
