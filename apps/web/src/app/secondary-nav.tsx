import { Link } from "@tanstack/react-router";

import { Icon } from "@/shared/icon.tsx";
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
  return (
    <nav
      id={properties.id}
      // Named, not headed: the rail beside it already shows the surface's name.
      aria-label={properties.surface.name}
      // Hidden rather than unmounted, so the button that governs it always names a region
      // that is there to be named.
      hidden={!properties.showing}
      className="shrink-0 border-b border-border bg-background px-2 py-3 md:sticky md:top-topbar md:h-[calc(100vh-var(--topbar-h))] md:w-sidebar md:self-start md:overflow-y-auto md:border-r md:border-b-0"
    >
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
                      // A fill, a weight and a bold glyph: the open screen survives greyscale.
                      "flex items-center gap-2 px-2 py-1.5 text-foreground transition-colors",
                      open ? "bg-[var(--surface-active)] font-medium" : "hover:bg-accent",
                    )}
                  >
                    <Icon
                      name={screen.icon}
                      weight={open ? "bold" : "regular"}
                      className={open ? "text-foreground" : "text-muted-foreground"}
                    />
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
