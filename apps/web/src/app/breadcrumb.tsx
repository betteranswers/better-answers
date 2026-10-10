import { useLinkProps } from "@tanstack/react-router";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import type { Place, VisibleArea } from "@/shared/navigation.ts";
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

const placeParts = ({ area, menuGroup, page }: Place<VisibleArea>): readonly Part[] => [
  { name: area.name, to: area.opensAt.path },
  // The reader's own copy of the group, so its first page is one they may see.
  ...(menuGroup?.name === undefined
    ? []
    : [{ name: menuGroup.name, to: menuGroup.pages[0]?.path ?? page.path }]),
  { name: page.name, to: page.path },
];

/** A name said twice in a row is said once, by the deeper part. */
const saidOnce = (named: readonly Part[]): readonly Part[] =>
  named.filter((part, at) => part.name !== named[at + 1]?.name);

const lastOnly = (parts: readonly Part[]): readonly Part[] =>
  parts.map((part, at) => (at === parts.length - 1 ? { ...part, to: undefined } : part));

/**
 * Broadest first. `below` is the open tab or a name a page gives: a person's, never folded into a
 * part above, or the page's own.
 */
export const partsOf = (
  open: Place<VisibleArea> | undefined,
  below: string | undefined,
): readonly Part[] => {
  if (open === undefined) return below === undefined ? [] : [{ name: below, to: undefined }];
  const beneath: readonly Part[] = below === undefined ? [] : [{ name: below, to: undefined }];
  return lastOnly(
    open.detail === undefined
      ? saidOnce([...placeParts(open), ...beneath])
      : [...saidOnce(placeParts(open)), ...beneath],
  );
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

          // By place, not name: a person's name may repeat a part above it.
          return [
            at === 0 ? null : (
              <BreadcrumbSeparator key={`${String(at)} after`} className="shrink-0">
                <Icon name="caret-right" />
              </BreadcrumbSeparator>
            ),
            <BreadcrumbItem key={String(at)} className={itemClass(wide, middle)}>
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
