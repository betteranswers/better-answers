import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/shared/lib/utils.ts";
import { useOpenTab } from "@/shared/page-toolbar.tsx";

/**
 * The frame's tabs stand outside the page, so its head draws where the frame says: null until
 * that place is drawn, undefined with no frame.
 */
export const PageHeadSlot = createContext<HTMLElement | null | undefined>(undefined);

export function PageHead(properties: {
  readonly heading: string;
  readonly summary?: string | undefined;
  /** Given by a page that sends focus to its first heading. */
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

/** An open tab already names its list, so there the heading is kept for a screen reader alone. */
export function ListHead(properties: {
  readonly heading: string;
  readonly headingId: string;
  /** Given by a list that sends focus to its heading. */
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly description?: ReactNode;
  /** Empty while the list is unread; the region stands, so its first words are announced. */
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
        className={cn(namedByATab && "sr-only")}
      >
        {heading}
      </h2>
      {description === undefined ? null : (
        <p className="mt-1 text-muted-foreground">{description}</p>
      )}
      <div className="mt-1 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <output className="block text-muted-foreground">{count}</output>
        {action}
      </div>
    </>
  );
}
