import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export const PageHeadSlot = createContext<HTMLElement | null | undefined>(undefined);

export function PageHead(properties: {
  readonly title: string;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const { title, headingRef } = properties;
  const slot = useContext(PageHeadSlot);

  const head = (
    <h1
      ref={headingRef}
      tabIndex={headingRef === undefined ? undefined : -1}
      className="wrap-anywhere"
    >
      {title}
    </h1>
  );

  if (slot === undefined) return head;
  return slot === null ? null : createPortal(head, slot);
}

export function ListHead(properties: {
  readonly heading: string;
  readonly headingId: string;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly count: ReactNode;
  readonly action?: ReactNode;
}) {
  const { heading, headingId, headingRef, count, action } = properties;

  return (
    <>
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
        className="peer sr-only"
      >
        {heading}
      </h2>
      <div className="mt-1 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2 peer-focus-visible:shadow-[var(--focus-ring)]">
        <output className="block text-muted-foreground">{count}</output>
        {action}
      </div>
    </>
  );
}
