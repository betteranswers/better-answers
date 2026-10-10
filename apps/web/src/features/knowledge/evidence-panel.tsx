import { useCallback, useEffect, useEffectEvent, useId, useRef, type RefObject } from "react";

import { ListRead } from "@/shared/list-pages.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet.tsx";

import { usePassage } from "./knowledge-api.ts";
import { EVIDENCE_WORDS, SEARCH_WORDS } from "./knowledge-words.ts";
import { outcomeOfFailure } from "./refusal.tsx";

/** A passage opened beside the page, and the control that opened it, where focus goes back. */
export type Opened = {
  readonly key: string;
  readonly locator: string;
  readonly title: string;
  readonly sensitivity: string;
  readonly openerId: string;
};

/** Mounted afresh for each source, so a second one chosen with the panel open takes focus too. */
const focusOnMount = (heading: HTMLHeadingElement | null): void => {
  heading?.focus();
};

const returnFocus = (opened: Opened): void => {
  document.getElementById(opened.openerId)?.focus();
};

export function SensitivityTag(properties: { readonly sensitivity: string }) {
  return (
    <Pill>
      {SEARCH_WORDS.notCompanyKnowledge} · {properties.sensitivity}
    </Pill>
  );
}

function PassageRead(properties: {
  readonly locator: string;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const passage = usePassage(properties.locator);
  return (
    <ListRead
      read={passage}
      loading={EVIDENCE_WORDS.loading}
      failed={(failure) => outcomeOfFailure(failure, "read").words}
      focusAfterRetry={properties.heading}
    >
      <blockquote className="border-l border-border bg-muted px-4 py-3 [font-size:var(--text-base)] leading-relaxed whitespace-pre-line">
        {passage.data?.passage?.text}
      </blockquote>
    </ListRead>
  );
}

const HEADING = "pr-8 font-semibold wrap-anywhere";

/** The sheet's title names the sheet; inline, the heading names its region. */
function PanelBody(properties: {
  readonly opened: Opened;
  readonly at: { readonly kind: "sheet" } | { readonly kind: "inline"; readonly headingId: string };
}) {
  const { opened, at } = properties;
  const heading = useRef<HTMLHeadingElement>(null);
  // Stable, so a render of the page around the panel never takes focus back to its heading.
  const held = useCallback((node: HTMLHeadingElement | null) => {
    heading.current = node;
    focusOnMount(node);
  }, []);
  return (
    <div className="flex flex-col gap-3">
      {at.kind === "sheet" ? (
        <SheetTitle asChild>
          <h2 ref={held} tabIndex={-1} className={HEADING}>
            {opened.title}
          </h2>
        </SheetTitle>
      ) : (
        <h3 ref={held} id={at.headingId} tabIndex={-1} className={HEADING}>
          {opened.title}
        </h3>
      )}
      <div>
        <SensitivityTag sensitivity={opened.sensitivity} />
      </div>
      <PassageRead locator={opened.locator} heading={heading} />
    </div>
  );
}

/** Beside the page at the wide layout: the list stays live, and a click on it never closes this. */
export function EvidenceSheet(properties: {
  readonly opened: Opened;
  readonly onClose: () => void;
}) {
  const { opened, onClose } = properties;
  const content = useRef<HTMLDivElement>(null);
  return (
    <Sheet
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        ref={content}
        overlay={false}
        aria-describedby={undefined}
        className="top-[var(--band-drawn-h)] h-auto overflow-y-auto p-4 shadow-none sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        // Focus left on the page, as by typing a new search, stays where the reader put it.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (document.activeElement === document.body) returnFocus(opened);
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        // Escape is the panel's only while focus is in it; elsewhere it is the control's own.
        onEscapeKeyDown={(event) => {
          if (!content.current?.contains(document.activeElement)) event.preventDefault();
        }}
      >
        <PanelBody key={opened.key} opened={opened} at={{ kind: "sheet" }} />
      </SheetContent>
    </Sheet>
  );
}

/** Beneath its match at the narrow layout, where a panel beside it would scroll the page sideways. */
export function EvidenceInline(properties: {
  readonly opened: Opened;
  readonly onClose: () => void;
}) {
  const { opened } = properties;
  const headingId = useId();
  const region = useRef<HTMLElement>(null);
  const close = () => {
    properties.onClose();
    returnFocus(opened);
  };
  const closeOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });

  // From anywhere inside, as the sheet's own Escape is.
  useEffect(() => {
    const here = region.current;
    here?.addEventListener("keydown", closeOnEscape);
    return () => {
      here?.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <section ref={region} aria-labelledby={headingId} className="mt-3 border-t border-border pt-3">
      <PanelBody key={opened.key} opened={opened} at={{ kind: "inline", headingId }} />
      <Button variant="outline" size="sm" className="mt-3" onClick={close}>
        {EVIDENCE_WORDS.close}
      </Button>
    </section>
  );
}
