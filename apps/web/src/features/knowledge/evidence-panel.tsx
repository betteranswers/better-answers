import { Link } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  type KeyboardEvent as KeyPress,
  type RefObject,
} from "react";

import { ListRead } from "@/shared/list-pages.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet.tsx";

import { conceptPageOf } from "./concept-address.ts";
import { ConceptBody, LINK } from "./concept-body.tsx";
import { kindOf, titleOf } from "./concept-frontmatter.ts";
import { useConcept, usePassage, type Opening } from "./knowledge-api.ts";
import { CONCEPT_WORDS, EVIDENCE_WORDS, SEARCH_WORDS } from "./knowledge-words.ts";
import { failedReadWords } from "./refusal.tsx";

/** `unmapped` is a match no concept rests on, which the panel says beside the passage's sensitivity. */
type OpenedSource =
  | (Extract<Opening, { readonly kind: "passage" }> & { readonly unmapped?: true })
  | Extract<Opening, { readonly kind: "concept" }>;

/** A source opened beside the page, and the control that opened it, where focus goes back. */
export type Opened = {
  readonly key: string;
  /** What its opener calls it, which names the panel until the read names the source itself. */
  readonly title: string;
  readonly source: OpenedSource;
  readonly openerId: string;
  /** Counts its opener's presses, so pressing it again brings focus back to the panel. */
  readonly pressed: number;
};

/** Mounted afresh for each source, so a second one chosen with the panel open takes focus too. */
const focusOnMount = (heading: HTMLHeadingElement | null): void => {
  heading?.focus();
};

const returnFocus = (opened: Opened): void => {
  document.getElementById(opened.openerId)?.focus();
};

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Radix loops Tab inside a dialog that is not modal too, so Tab off either end leaves it. */
const tabsOff = (event: KeyPress<HTMLElement>): boolean => {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return false;
  const tabbable = [...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)];
  const at = document.activeElement;
  if (event.shiftKey) return at === tabbable[0] || !tabbable.some((each) => each === at);
  return at === tabbable.at(-1);
};

export function SensitivityTag(properties: { readonly sensitivity: string }) {
  return (
    <Pill>
      {SEARCH_WORDS.notCompanyKnowledge} · {properties.sensitivity}
    </Pill>
  );
}

export type Heading = RefObject<HTMLHeadingElement | null>;

const QUOTED =
  "border-l border-border bg-muted px-4 py-3 [font-size:var(--text-base)] leading-relaxed whitespace-pre-line";

type PassageSource = Extract<OpenedSource, { readonly kind: "passage" }>;

/** A match's title is the search's copy of it, so the read's own takes its place as it lands. */
function TitleRead(properties: { readonly locator: string; readonly until: string }) {
  return usePassage(properties.locator).data?.passage?.source ?? properties.until;
}

/** The sensitivity is the read's own; the document's title stands under a concept's label for it. */
function PassageRead(properties: {
  readonly opened: Opened;
  readonly source: PassageSource;
  readonly heading: Heading;
}) {
  const { opened, source } = properties;
  const passage = usePassage(source.locator);
  const read = passage.data?.passage;
  const unmapped = source.unmapped !== undefined;
  return (
    <ListRead
      read={passage}
      loading={EVIDENCE_WORDS.loading}
      failed={failedReadWords}
      focusAfterRetry={properties.heading}
    >
      {read === undefined ? null : (
        <div>
          {unmapped ? (
            <SensitivityTag sensitivity={read.sensitivity} />
          ) : (
            <Pill>{read.sensitivity}</Pill>
          )}
        </div>
      )}
      {read === undefined || unmapped || read.source === opened.title ? null : (
        <p className="font-medium wrap-anywhere">{read.source}</p>
      )}
      <blockquote className={QUOTED}>{read?.text}</blockquote>
    </ListRead>
  );
}

/** One level only: its own marks are text, and its page is where they open. */
function CitedConcept(properties: {
  readonly opened: Opened;
  readonly iri: string;
  readonly heading: Heading;
  readonly headingsFrom: number;
}) {
  const { opened, iri } = properties;
  const concept = useConcept(iri);
  const read = concept.data?.concept;
  const page = conceptPageOf(iri);
  return (
    <ListRead
      read={concept}
      loading={CONCEPT_WORDS.loading}
      failed={failedReadWords}
      focusAfterRetry={properties.heading}
    >
      {read === undefined ? null : (
        <>
          <div className="flex flex-wrap gap-2">
            {kindOf(read.frontmatter) === undefined ? null : (
              <Pill>{kindOf(read.frontmatter)}</Pill>
            )}
            <Pill>{read.trustWords}</Pill>
          </div>
          {titleOf(read.frontmatter) === opened.title ? null : (
            <p className="font-medium wrap-anywhere">{titleOf(read.frontmatter)}</p>
          )}
          <ConceptBody
            body={read.body}
            evidence={read.evidence}
            headingsFrom={properties.headingsFrom}
          />
        </>
      )}
      {page === undefined ? null : (
        <p>
          <Link to={page} className={LINK}>
            {CONCEPT_WORDS.ownPage}
          </Link>
        </p>
      )}
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
  const { source } = opened;
  const heading = useRef<HTMLHeadingElement>(null);
  // Stable, so a render of the page around the panel never takes focus back to its heading.
  const held = useCallback((node: HTMLHeadingElement | null) => {
    heading.current = node;
    focusOnMount(node);
  }, []);
  const title =
    source.kind === "passage" && source.unmapped !== undefined ? (
      <TitleRead locator={source.locator} until={opened.title} />
    ) : (
      opened.title
    );
  return (
    <div className="flex flex-col gap-3">
      {at.kind === "sheet" ? (
        <SheetTitle asChild>
          <h2 ref={held} tabIndex={-1} className={HEADING}>
            {title}
          </h2>
        </SheetTitle>
      ) : (
        <h3 ref={held} id={at.headingId} tabIndex={-1} className={HEADING}>
          {title}
        </h3>
      )}
      {source.kind === "passage" ? (
        <PassageRead opened={opened} source={source} heading={heading} />
      ) : (
        <CitedConcept
          opened={opened}
          iri={source.iri}
          heading={heading}
          headingsFrom={at.kind === "sheet" ? 3 : 4}
        />
      )}
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
        // Beside its opener in the tab order: Tab off the panel lands on the match that opened it.
        onKeyDown={(event) => {
          if (!tabsOff(event)) return;
          event.preventDefault();
          returnFocus(opened);
        }}
        // Escape is the panel's only while focus is in it; elsewhere it is the control's own.
        onEscapeKeyDown={(event) => {
          if (!content.current?.contains(document.activeElement)) event.preventDefault();
        }}
      >
        <PanelBody
          key={`${opened.key}:${String(opened.pressed)}`}
          opened={opened}
          at={{ kind: "sheet" }}
        />
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
      <PanelBody
        key={`${opened.key}:${String(opened.pressed)}`}
        opened={opened}
        at={{ kind: "inline", headingId }}
      />
      <Button variant="outline" size="sm" className="mt-3" onClick={close}>
        {EVIDENCE_WORDS.close}
      </Button>
    </section>
  );
}
