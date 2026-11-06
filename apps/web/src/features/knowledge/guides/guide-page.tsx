import { Link } from "@tanstack/react-router";
import { useId, useRef, useState, type RefObject } from "react";

import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { BROWSE, conceptPageOf } from "@/shared/knowledge/concept-address.ts";
import { LINK } from "@/shared/knowledge/concept-body.tsx";
import { guideTitleOf } from "@/shared/knowledge/guide-title.ts";
import { failedReadWords } from "@/shared/knowledge/refusal.tsx";
import { ListState } from "@/shared/list/list-pages.tsx";
import { rowInFocus } from "@/shared/list/row-focus.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { useBreadcrumbLastPart } from "@/shared/page/breadcrumb-last-part.ts";
import { PageHead } from "@/shared/page/page-head.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { useGuide, type Guide } from "../knowledge-api.ts";
import { LeavingAsk, useLeavingGuard } from "./brief-actions.tsx";
import type { Say } from "./brief-editing.ts";
import { said } from "./guide-outcome.ts";
import { GuideSectionView } from "./guide-section.tsx";
import {
  GUIDE_KEYSTROKES as KEY,
  GUIDES_PAGE,
  SECTION_ACTIONS,
  type SectionAction,
} from "./guide-state.ts";
import { GUIDE_WORDS as WORDS, SAID_OF_GUIDES } from "./guide-words.ts";

const READING = [KEY.showDetail, KEY.addFact, KEY.copyBrief];

const EDITING = [...READING, KEY.editBrief, KEY.saveBrief, KEY.leave];

const STATUS_BAR = "sticky top-0 z-10 mt-4 border border-border bg-background px-3 py-2";

const canEdit = (guide: Guide): boolean =>
  guide.sections.some((section) => section.brief?.editable !== undefined);

const controlOf = (row: Element, action: SectionAction): HTMLElement | null => {
  const wanted = `[data-action="${action}"]`;
  const fact = document.activeElement?.closest("[data-fact]");
  return fact?.querySelector<HTMLElement>(wanted) ?? row.querySelector<HTMLElement>(wanted);
};

const copyRefusedWords = (guide: Guide): string => {
  const section = rowInFocus(guide.sections, (each) => each.sectionId);
  const shown = section?.brief !== undefined && section.brief.rendered.markdown.trim() !== "";
  return shown && section.copy === "below-action-threshold"
    ? WORDS.belowYourRole
    : WORDS.nothingToCopy;
};

const nothingToDo = (guide: Guide, action: SectionAction): string | undefined => {
  if (action === SECTION_ACTIONS.addFact) return WORDS.nothingToAdd;
  return action === SECTION_ACTIONS.copyBrief ? copyRefusedWords(guide) : undefined;
};

const useSectionKeys = (guide: Guide, say: Say) => {
  const editor = canEdit(guide);
  const press = (action: SectionAction) => () => {
    const row = document.activeElement?.closest("[data-row]");
    if (row === null || row === undefined) {
      if (action !== SECTION_ACTIONS.editBrief || editor) say(said(WORDS.selectFirst));
      return;
    }
    const control = controlOf(row, action);
    if (control !== null) {
      control.click();
      return;
    }
    const nothing = nothingToDo(guide, action);
    if (nothing !== undefined) say(said(nothing));
  };
  useKeystroke(KEY.showDetail, press(SECTION_ACTIONS.showDetail));
  useKeystroke(KEY.addFact, press(SECTION_ACTIONS.addFact));
  useKeystroke(KEY.editBrief, press(SECTION_ACTIONS.editBrief));
  useKeystroke(KEY.copyBrief, press(SECTION_ACTIONS.copyBrief));
};

function NoSuchGuide() {
  return (
    <ListState
      state={{
        kind: "empty",
        words: SAID_OF_GUIDES["not-found"],
        action: (
          <Link to={GUIDES_PAGE.path} className={LINK}>
            {WORDS.toGuides}
          </Link>
        ),
      }}
    />
  );
}

const namesNothing = (failure: Error | ApiError): boolean => {
  const word = refusalOf(failure)?.word;
  return word === "not-found" || word === "malformed";
};

function GuideHeader(properties: { readonly guide: Guide; readonly titleId: string }) {
  const { guide } = properties;
  const subject = guide.subject;
  const subjectPage = subject === null ? undefined : conceptPageOf(subject.iri);
  return (
    <header className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill>{guide.kind}</Pill>
        <Pill variant="outline">{guide.collection}</Pill>
      </div>
      <h2 id={properties.titleId} className="mt-3 [font-size:var(--text-2xl)] wrap-anywhere">
        {guideTitleOf(guide)}
      </h2>
      {subject === null || subjectPage === undefined ? null : (
        <p className="mt-2">
          <span className="text-muted-foreground">{WORDS.subject} </span>
          <Link to={subjectPage} className={LINK}>
            {subject.title}
          </Link>
        </p>
      )}
      <p className="mt-2 font-medium">{WORDS.total(guide.coverage.met, guide.coverage.of)}</p>
    </header>
  );
}

function GuideShown(properties: { readonly guide: Guide }) {
  const { guide } = properties;
  useBreadcrumbLastPart(guideTitleOf(guide));
  const titleId = useId();
  const [outcome, say] = useState<Outcome>();
  const guard = useLeavingGuard();
  usePageKeystrokes(canEdit(guide) ? EDITING : READING);
  useSectionKeys(guide, say);

  return (
    <article aria-labelledby={titleId} className="mt-6">
      <GuideHeader guide={guide} titleId={titleId} />
      <OutcomeLine outcome={outcome} className={outcome === undefined ? "" : STATUS_BAR} />
      <LeavingAsk leaving={guard.leaving} />
      <ol className="mt-6 grid gap-8">
        {guide.sections.map((section) => (
          <GuideSectionView
            key={section.sectionId}
            guide={guide}
            section={section}
            say={say}
            reportUnsaved={guard.report}
          />
        ))}
      </ol>
    </article>
  );
}

function GuideRead(properties: {
  readonly guideId: string;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const read = useGuide(properties.guideId);
  if (read.error !== null) {
    if (namesNothing(read.error)) return <NoSuchGuide />;
    return (
      <ListState
        state={{
          kind: "failed",
          words: failedReadWords(read.error),
          onRetry: () => {
            void read.refetch();
          },
          focusAfterRetry: properties.heading,
        }}
      />
    );
  }
  if (read.data === undefined) {
    return (
      <>
        <div aria-hidden className="mt-6 min-h-24" />
        <ListState state={{ kind: "loading", words: WORDS.loading }} />
      </>
    );
  }
  return <GuideShown guide={read.data} />;
}

export function GuidePage(properties: { readonly guideId: string | undefined }) {
  const { guideId } = properties;
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <>
      <PageHead heading={BROWSE.name} headingRef={heading} />
      {guideId === undefined ? (
        <NoSuchGuide />
      ) : (
        <GuideRead key={guideId} guideId={guideId} heading={heading} />
      )}
    </>
  );
}
