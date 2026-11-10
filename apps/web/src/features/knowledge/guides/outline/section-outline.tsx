import { ChevronDownIcon } from "lucide-react";
import { useId, useMemo, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";

import { cn } from "@/shared/lib/utils.ts";
import { Button } from "@/shared/ui/button.tsx";

import type { SectionProps } from "../guide-section.tsx";
import { headingIdOf } from "../guide-state.ts";
import { GUIDE_WORDS as WORDS } from "../guide-words.ts";
import { useCurrentSection } from "./current-section.ts";

type Section = SectionProps["section"];

const INDENTS = ["", "pl-6", "pl-9", "pl-12"] as const;

const indentOf = (number: string): string =>
  INDENTS[Math.min(number.split(".").length, INDENTS.length) - 1] ?? "";

const goTo = (headingId: string): void => {
  const heading = document.getElementById(headingId);
  if (heading === null) return;
  heading.scrollIntoView();
  heading.focus({ preventScroll: true });
};

function Entry(properties: {
  readonly section: Section;
  readonly current: boolean;
  readonly onChoose: () => void;
}) {
  const { section, current, onChoose } = properties;
  const headingId = headingIdOf(section.sectionId);
  const { met, of } = section.coverage;
  const choose = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onChoose();
    goTo(headingId);
  };
  return (
    <li>
      <a
        href={`#${headingId}`}
        aria-current={current ? "location" : undefined}
        onClick={choose}
        className={cn(
          "block py-1.5 pr-3 pl-3 transition-colors",
          indentOf(section.number),
          current ? "bg-[var(--surface-active)]" : "hover:bg-accent",
        )}
      >
        <span className={cn("block wrap-anywhere", current && "font-medium")}>
          {WORDS.heading(section.number, section.prompt)}
        </span>
        {of === 0 ? null : (
          <span className="block text-muted-foreground [font-size:var(--text-sm)]">
            {WORDS.total(met, of)}
          </span>
        )}
        <span className="block text-muted-foreground [font-size:var(--text-sm)]">
          {section.trustWords}
        </span>
      </a>
    </li>
  );
}

const BESIDE =
  "sticky top-[calc(var(--band-drawn-h)+1rem)] col-start-2 row-start-1 -mx-1 mt-5 max-h-[calc(100vh-var(--band-drawn-h)-2rem)] self-start overflow-y-auto bg-background p-1";

const FOLDED =
  "mt-6 lg:sticky lg:top-[var(--band-drawn-h)] lg:z-10 lg:-mx-1 lg:bg-background lg:p-1";

export function SectionOutline(properties: {
  readonly sections: readonly Section[];
  readonly beside: boolean;
}) {
  const { sections, beside } = properties;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const ids = useMemo(() => sections.map(({ sectionId }) => headingIdOf(sectionId)), [sections]);
  const current = useCurrentSection(ids);
  return (
    <nav aria-label={WORDS.outline} className={beside ? BESIDE : FOLDED}>
      {beside ? null : (
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {WORDS.outline}
          <ChevronDownIcon
            aria-hidden
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </Button>
      )}
      <ol
        id={listId}
        className={cn(
          beside
            ? "border-l border-border"
            : "mt-2 max-h-[calc(100vh-var(--band-drawn-h)-6rem)] overflow-y-auto",
          !beside && !open && "hidden",
        )}
      >
        {sections.map((section, at) => (
          <Entry
            key={section.sectionId}
            section={section}
            current={ids[at] === current}
            onChoose={() => {
              flushSync(() => {
                setOpen(false);
              });
            }}
          />
        ))}
      </ol>
    </nav>
  );
}
