import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { cn } from "@/shared/lib/utils.ts";
import { viewsOf, type Screen } from "@/shared/screens.ts";

export function SecondaryNav(properties: {
  readonly screen: Screen;
  readonly openViewPath: string | undefined;
}) {
  const named = useId();

  return (
    <nav
      aria-labelledby={named}
      className="shrink-0 border-b border-border bg-sidebar px-2 py-3 md:sticky md:top-0 md:h-screen md:w-sidebar md:self-start md:overflow-y-auto md:border-r md:border-b-0"
    >
      <h2
        id={named}
        className="px-2 pb-2 font-medium text-muted-foreground uppercase [font-size:var(--text-2xs)] [letter-spacing:var(--tracking-caps)]"
      >
        {properties.screen.name}
      </h2>

      <ul className="flex flex-col gap-0.5">
        {viewsOf(properties.screen).map((view) => {
          const open = view.path === properties.openViewPath;

          return (
            <li key={view.path}>
              {/* `aria-current` is the router's, off this same address; set here it would be
                  written twice. */}
              <Link
                to={view.path}
                className={cn(
                  // Weight, not only tint: the open view survives a greyscale screen.
                  "block px-2 py-1.5 transition-colors",
                  open
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-foreground hover:bg-accent",
                )}
              >
                {view.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
