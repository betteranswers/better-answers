import { useId, useMemo, useState, type MouseEvent } from "react";

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
    goTo(headingId);
    onChoose();
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

export function SectionOutline(properties: { readonly sections: readonly Section[] }) {
  const { sections } = properties;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const ids = useMemo(() => sections.map(({ sectionId }) => headingIdOf(sectionId)), [sections]);
  const current = useCurrentSection(ids);
  return (
    <nav
      aria-label={WORDS.outline}
      className="mt-6 xl:sticky xl:top-[calc(var(--band-drawn-h)+1rem)] xl:col-start-2 xl:row-start-1 xl:-mx-1 xl:mt-5 xl:max-h-[calc(100vh-var(--band-drawn-h)-2rem)] xl:self-start xl:overflow-y-auto xl:bg-background xl:p-1"
    >
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={listId}
        className="xl:hidden"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {WORDS.outline}
      </Button>
      <ol
        id={listId}
        className={cn("mt-2 xl:mt-0 xl:block xl:border-l xl:border-border", !open && "hidden")}
      >
        {sections.map((section, at) => (
          <Entry
            key={section.sectionId}
            section={section}
            current={ids[at] === current}
            onChoose={() => {
              setOpen(false);
            }}
          />
        ))}
      </ol>
    </nav>
  );
}
