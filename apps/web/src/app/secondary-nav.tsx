import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { cn } from "@/shared/lib/utils.ts";
import type { Surface } from "@/shared/navigation.ts";

const HEADING =
  "px-2 pb-2 font-medium text-muted-foreground uppercase [font-size:var(--text-2xs)] [letter-spacing:var(--tracking-caps)]";

/** `surface` is the reader's own reading of it, so it holds only what they may see. */
export function SecondaryNav(properties: {
  readonly surface: Surface;
  readonly openScreenPath: string | undefined;
  readonly showing: boolean;
  readonly id?: string;
  readonly onChoose?: () => void;
}) {
  const named = useId();

  return (
    <nav
      id={properties.id}
      aria-labelledby={named}
      // Hidden rather than unmounted, so the button that governs it always names a region
      // that is there to be named.
      hidden={!properties.showing}
      className="shrink-0 border-b border-border bg-sidebar px-2 py-3 md:sticky md:top-0 md:h-screen md:w-sidebar md:self-start md:overflow-y-auto md:border-r md:border-b-0"
    >
      <h2 id={named} className={HEADING}>
        {properties.surface.name}
      </h2>

      {properties.surface.groups.map((group) => (
        <div key={group.id} className="pb-2">
          {group.name === undefined ? null : <h3 className={HEADING}>{group.name}</h3>}

          <ul className="flex flex-col gap-0.5">
            {group.screens.map((screen) => {
              const open = screen.path === properties.openScreenPath;

              return (
                <li key={screen.path}>
                  {/* `aria-current` is the router's, off this same address; set here it would
                      be written twice. */}
                  <Link
                    to={screen.path}
                    onClick={properties.onChoose}
                    className={cn(
                      // Weight, not only tint: the open screen survives a greyscale screen.
                      "block px-2 py-1.5 transition-colors",
                      open
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-foreground hover:bg-accent",
                    )}
                  >
                    {screen.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
