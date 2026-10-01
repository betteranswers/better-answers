import { useLinkProps } from "@tanstack/react-router";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import type { Place, VisibleSurface } from "@/shared/navigation.ts";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb.tsx";

import { BREADCRUMB } from "./words.ts";

/** `to` is undefined for the last part alone, the place the reader is on. */
export type Part = { readonly name: string; readonly to: string | undefined };

/** Broadest first. A name said twice in a row is said once, by the deeper part. */
export const partsOf = (
  open: Place<VisibleSurface> | undefined,
  openTab: string | undefined,
): readonly Part[] => {
  if (open === undefined) return [];
  const { surface, group, screen } = open;

  const named: readonly Part[] = [
    { name: surface.name, to: surface.opensAt.path },
    // The reader's own copy of the group, so its first screen is one they may see.
    ...(group?.name === undefined
      ? []
      : [{ name: group.name, to: group.screens[0]?.path ?? screen.path }]),
    { name: screen.name, to: screen.path },
    ...(openTab === undefined ? [] : [{ name: openTab, to: undefined }]),
  ];
  const once = named.filter((part, at) => part.name !== named[at + 1]?.name);
  return once.map((part, at) => (at === once.length - 1 ? { ...part, to: undefined } : part));
};

/** The router marks every link to the open address as the page, and only the last part is. */
function PartLink(properties: {
  readonly to: string;
  readonly name: string;
  readonly className: string | undefined;
}) {
  const { "aria-current": _markedByTheRouter, ...link } = useLinkProps({ to: properties.to });

  return (
    <BreadcrumbLink {...link} className={properties.className}>
      {properties.name}
    </BreadcrumbLink>
  );
}

/** Wide, only the middle parts give way, so the last is never cut; narrow, the row wraps. */
const itemClass = (wide: boolean, middle: boolean): string | undefined => {
  if (!wide) return undefined;
  return middle ? "min-w-0" : "shrink-0";
};

export function BandBreadcrumb(properties: {
  readonly parts: readonly Part[];
  readonly wide: boolean;
  readonly className?: string;
}) {
  const { parts, wide } = properties;
  if (parts.length === 0) return null;

  return (
    <Breadcrumb aria-label={BREADCRUMB} className={cn("min-w-0", properties.className)}>
      <BreadcrumbList className={cn("sm:gap-1.5", wide && "flex-nowrap")}>
        {parts.map((part, at) => {
          const middle = at > 0 && at < parts.length - 1;

          return [
            at === 0 ? null : (
              <BreadcrumbSeparator key={`${part.name} after`} className="shrink-0">
                <Icon name="caret-right" />
              </BreadcrumbSeparator>
            ),
            <BreadcrumbItem key={part.name} className={itemClass(wide, middle)}>
              {part.to === undefined ? (
                <BreadcrumbPage>{part.name}</BreadcrumbPage>
              ) : (
                <PartLink
                  to={part.to}
                  name={part.name}
                  className={wide && middle ? "truncate" : undefined}
                />
              )}
            </BreadcrumbItem>,
          ];
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
