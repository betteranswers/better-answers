import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";

import { conceptPageOf } from "@/shared/knowledge/concept-address.ts";
import { ConceptBody, LINK } from "@/shared/knowledge/concept-body.tsx";
import type { Evidence } from "@/shared/knowledge/knowledge-reads.ts";
import { cn } from "@/shared/lib/utils.ts";
import { keyedRow } from "@/shared/list/row-focus.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import {
  useBriefCopy,
  useIncludeAvailable,
  type Guide,
  type GuideSection,
  type SectionBrief,
} from "../knowledge-api.ts";
import { useBriefEditing } from "./brief-actions.tsx";
import { copyBrief, copyingWords } from "./brief-clipboard.ts";
import type { Say } from "./brief-editing.ts";
import { Coverage, type Gaps } from "./guide-coverage.tsx";
import { failed, said } from "./guide-outcome.ts";
import { actionNamed, addFactAt, GUIDE_KEYSTROKES as KEY, SECTION_ACTIONS } from "./guide-state.ts";
import { GUIDE_WORDS as WORDS } from "./guide-words.ts";

export type SectionProps = {
  readonly guide: Guide;
  readonly section: GuideSection;
  readonly say: Say;
  readonly reportUnsaved: (sectionId: string, unsaved: boolean) => void;
};

const HEADINGS = ["h3", "h4", "h5", "h6"] as const;

const INDENTS = ["", "pl-4", "pl-8", "pl-12"] as const;

const depthOf = (number: string): number => Math.min(number.split(".").length, HEADINGS.length) - 1;

const headingsBelow = (level: number): number => Math.min(level + 4, 6);

const NO_EVIDENCE: readonly Evidence[] = [];

function Footnotes(properties: { readonly footnotes: SectionBrief["rendered"]["footnotes"] }) {
  const { footnotes } = properties;
  if (footnotes.length === 0) return null;
  return (
    <ol aria-label={WORDS.footnotes} className="mt-3 list-decimal pl-6 [font-size:var(--text-sm)]">
      {footnotes.map((footnote) => {
        const page = conceptPageOf(footnote.iri);
        return (
          <li key={footnote.label}>
            {page === undefined ? (
              <span className="wrap-anywhere">{footnote.title}</span>
            ) : (
              <Link to={page} className={cn(LINK, "inline-block min-h-6 wrap-anywhere")}>
                {footnote.title}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function BriefText(properties: {
  readonly brief: SectionBrief;
  readonly assembled: boolean;
  readonly below: number;
}) {
  const { rendered } = properties.brief;
  const evidence = useMemo(
    () =>
      rendered.footnotes.map((footnote) => ({
        id: String(footnote.number),
        source: footnote.title,
      })),
    [rendered.footnotes],
  );
  if (rendered.markdown.trim() === "") {
    return properties.assembled ? (
      <p className="mt-4 text-muted-foreground">{WORDS.noBrief}</p>
    ) : null;
  }
  return (
    <div className="mt-4">
      <ConceptBody body={rendered.markdown} evidence={evidence} headingsFrom={properties.below} />
      <Footnotes footnotes={rendered.footnotes} />
    </div>
  );
}

function Detail(properties: {
  readonly brief: SectionBrief;
  readonly number: string;
  readonly level: number;
  readonly region: RefObject<HTMLElement | null>;
  readonly id: string;
}) {
  const { brief, level, region } = properties;
  const Title = HEADINGS[Math.min(level, HEADINGS.length - 1)] ?? "h6";
  return (
    <section
      ref={region}
      id={properties.id}
      aria-label={WORDS.detailOf(properties.number)}
      tabIndex={-1}
      className="mt-4 grid gap-6 border-l border-border pl-4 outline-none focus-visible:[box-shadow:var(--focus-ring)]"
    >
      {brief.detail.length === 0 ? <p className="text-muted-foreground">{WORDS.noDetail}</p> : null}
      {brief.detail.map((concept) => {
        const page = conceptPageOf(concept.iri);
        return (
          <article key={concept.iri}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Title className="font-semibold [font-size:var(--text-md)]">
                {page === undefined ? (
                  concept.title
                ) : (
                  <Link to={page} className={cn(LINK, "wrap-anywhere")}>
                    {concept.title}
                  </Link>
                )}
              </Title>
              <Pill>{concept.kind}</Pill>
            </div>
            <div className="mt-2">
              <ConceptBody
                body={concept.body}
                evidence={NO_EVIDENCE}
                headingsFrom={headingsBelow(level)}
              />
            </div>
          </article>
        );
      })}
    </section>
  );
}

const useDetail = (section: GuideSection, button: RefObject<HTMLButtonElement | null>) => {
  const [open, setOpen] = useState(!section.layers.includes("assembled"));
  const region = useRef<HTMLElement>(null);
  const pressed = useRef(false);
  useEffect(() => {
    if (!open || !pressed.current) return;
    pressed.current = false;
    region.current?.focus();
  }, [open]);
  return {
    open,
    region,
    toggle: () => {
      pressed.current = !open;
      setOpen(!open);
      if (open) button.current?.focus();
    },
  };
};

const useIncluding = (section: GuideSection, say: Say, heading: RefObject<HTMLElement | null>) => {
  const include = useIncludeAvailable();
  const [including, setIncluding] = useState(false);

  const run = async () => {
    if (including) return;
    setIncluding(true);
    try {
      const { included } = await include(section.writeUpId);
      say(
        said(
          included === 0 ? WORDS.nothingIncluded(section.number) : WORDS.included(section.number),
        ),
      );
      heading.current?.focus();
    } catch (thrown) {
      say(failed(thrown instanceof Error ? thrown : new Error(String(thrown))));
    } finally {
      setIncluding(false);
    }
  };
  return {
    including,
    onInclude: () => {
      void run();
    },
  };
};

const useCopying = (section: GuideSection, say: Say, editing: boolean) => {
  const brief = useBriefCopy();
  const [copying, setCopying] = useState(false);

  const run = async () => {
    if (copying) return;
    if (editing) {
      say(said(WORDS.closeToCopy));
      return;
    }
    setCopying(true);
    say(said(WORDS.copying(section.number)));
    try {
      const done = await copyBrief(
        () => brief.read(section.writeUpId),
        (copy) => brief.record(section.writeUpId, copy.version),
      );
      say(said(copyingWords(section.number, done)));
    } catch (thrown) {
      say(failed(thrown instanceof Error ? thrown : new Error(String(thrown))));
    } finally {
      setCopying(false);
    }
  };
  return {
    copying,
    onCopy: () => {
      void run();
    },
  };
};

function CopyAction(properties: {
  readonly section: GuideSection;
  readonly copying: ReturnType<typeof useCopying>;
}) {
  const { section, copying } = properties;
  if (section.copy === "below-action-threshold") {
    return <p className="text-muted-foreground">{WORDS.belowYourRole}</p>;
  }
  return (
    <Button
      type="button"
      variant="outline"
      {...actionNamed(SECTION_ACTIONS.copyBrief)}
      aria-disabled={copying.copying}
      aria-keyshortcuts={KEY.copyBrief.key}
      onClick={copying.onCopy}
    >
      {WORDS.copy}
    </Button>
  );
}

function SectionHead(properties: {
  readonly section: GuideSection;
  readonly headingId: string;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { section, heading } = properties;
  const Heading = HEADINGS[depthOf(section.number)] ?? "h6";
  return (
    <>
      <Heading
        ref={heading}
        id={properties.headingId}
        tabIndex={-1}
        className="font-semibold [font-size:var(--text-lg)]"
      >
        {WORDS.heading(section.number, section.prompt)}
      </Heading>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Pill>{section.trustWords}</Pill>
        {section.needsReview === null ? null : (
          <>
            <Pill variant="outline">{WORDS.needsReview}</Pill>
            <span>{WORDS.reasons[section.needsReview]}</span>
          </>
        )}
      </div>
      {section.usageNote === null ? null : (
        <p className="mt-2 text-muted-foreground">{section.usageNote}</p>
      )}
    </>
  );
}

export function GuideSectionView(properties: SectionProps) {
  const { guide, section, say } = properties;
  const { brief } = section;
  const headingId = useId();
  const detailId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const showDetail = useRef<HTMLButtonElement>(null);
  const detail = useDetail(section, showDetail);
  const including = useIncluding(section, say, heading);
  const editing = useBriefEditing({
    sectionId: section.sectionId,
    writeUpId: section.writeUpId,
    number: section.number,
    brief,
    say,
    reportUnsaved: properties.reportUnsaved,
  });
  const copying = useCopying(section, say, editing.open);
  const unmet = section.coverage.facts.filter((fact) => fact.state !== "met");
  const onAdd = (href: string) => {
    void navigate({ href });
  };

  const gaps: Gaps = {
    met: section.coverage.met,
    of: section.coverage.of,
    unmet,
    owner: guide.owner?.name,
    hrefOf: (fact) => addFactAt(guide, fact),
    canInclude: brief?.editable !== undefined,
    including: including.including,
    onInclude: including.onInclude,
    onAdd,
  };
  const level = depthOf(section.number);

  return (
    <li {...keyedRow(section.sectionId)} className={INDENTS[level]}>
      <section aria-labelledby={headingId} className="border-t border-border pt-6">
        <SectionHead section={section} headingId={headingId} heading={heading} />
        {brief === undefined ? (
          <p className="mt-3 text-muted-foreground">{WORDS.withheld}</p>
        ) : (
          <>
            <BriefText
              brief={brief}
              assembled={section.layers.includes("assembled")}
              below={headingsBelow(level)}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {editing.actions}
              {brief.rendered.markdown.trim() === "" ? null : (
                <CopyAction section={section} copying={copying} />
              )}
              <Button
                ref={showDetail}
                type="button"
                variant="outline"
                {...actionNamed(SECTION_ACTIONS.showDetail)}
                aria-expanded={detail.open}
                aria-controls={detailId}
                aria-keyshortcuts={KEY.showDetail.key}
                onClick={detail.toggle}
              >
                {WORDS.showDetail}
              </Button>
            </div>
            {editing.editor}
            {detail.open ? (
              <Detail
                brief={brief}
                number={section.number}
                level={level + 1}
                region={detail.region}
                id={detailId}
              />
            ) : null}
          </>
        )}
        <Coverage gaps={gaps} />
      </section>
    </li>
  );
}
