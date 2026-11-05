import { useLinkProps } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import type { VisibleArea } from "@/shared/navigation.ts";

const HEADING =
  "px-2 pb-2 font-medium text-muted-foreground uppercase [font-size:var(--text-2xs)] [letter-spacing:var(--tracking-caps)]";

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly "data-status"?: string;
};

function MenuLink(properties: {
  readonly to: string;
  readonly open: boolean;
  readonly onChoose: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const {
    "aria-current": _markedByTheRouter,
    "data-status": _statusOfTheRouter,
    ...link
  }: AnchorProps = useLinkProps({ to: properties.to, onClick: properties.onChoose });

  return (
    <a
      {...link}
      aria-current={properties.open ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 text-foreground transition-colors",
        properties.open ? "bg-[var(--surface-active)] font-medium" : "hover:bg-accent",
      )}
    >
      {properties.children}
    </a>
  );
}

export function Menu(properties: {
  readonly area: VisibleArea;
  readonly openPagePath: string | undefined;
  readonly showing: boolean;
  readonly id?: string;
  readonly onChoose?: () => void;
}) {
  return (
    <nav
      id={properties.id}
      aria-label={properties.area.name}
      hidden={!properties.showing}
      className="shrink-0 border-b border-border bg-background px-2 py-3 md:sticky md:top-[var(--band-drawn-h)] md:h-[calc(100vh-var(--band-drawn-h))] md:w-sidebar md:self-start md:overflow-y-auto md:border-r md:border-b-0"
    >
      {properties.area.menuGroups.map((group) => (
        <div key={group.id} className="pb-2">
          {group.name === undefined ? null : <h3 className={HEADING}>{group.name}</h3>}

          <ul className="flex flex-col gap-0.5">
            {group.pages.map((page) => {
              const open = page.path === properties.openPagePath;

              return (
                <li key={page.path}>
                  <MenuLink to={page.path} open={open} onChoose={properties.onChoose}>
                    <Icon
                      name={page.icon}
                      weight={open ? "bold" : "regular"}
                      className={open ? "text-foreground" : "text-muted-foreground"}
                    />
                    {page.name}
                  </MenuLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
