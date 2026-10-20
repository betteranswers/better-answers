import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/shared/lib/utils.ts";
import { useOpenTab } from "@/shared/page-toolbar.tsx";

export const PageHeadSlot = createContext<HTMLElement | null | undefined>(undefined);

export function PageHead(properties: {
  readonly heading: string;
  readonly summary?: ReactNode;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const { heading, summary, headingRef } = properties;
  const slot = useContext(PageHeadSlot);

  const head = (
    <>
      <h1 ref={headingRef} tabIndex={headingRef === undefined ? undefined : -1}>
        {heading}
      </h1>
      {summary === undefined ? null : <p className="mt-2 text-muted-foreground">{summary}</p>}
    </>
  );

  if (slot === undefined) return head;
  return slot === null ? null : createPortal(head, slot);
}

export function ListHead(properties: {
  readonly heading: string;
  readonly headingId: string;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly description?: ReactNode;
  readonly count: ReactNode;
  readonly action?: ReactNode;
}) {
  const { heading, headingId, headingRef, description, count, action } = properties;
  const namedByATab = useOpenTab() !== undefined;

  return (
    <>
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
        className={cn(namedByATab && "peer sr-only")}
      >
        {heading}
      </h2>
      {description === undefined ? null : (
        <p className="mt-1 text-muted-foreground">{description}</p>
      )}
      <div
        className={cn(
          "mt-1 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2",
          namedByATab && "peer-focus-visible:shadow-[var(--focus-ring)]",
        )}
      >
        <output className="block text-muted-foreground">{count}</output>
        {action}
      </div>
    </>
  );
}
