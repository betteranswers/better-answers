import { useId } from "react";

import { RowLink } from "@/shared/list/grid-table.tsx";
import { Button, buttonVariants } from "@/shared/ui/button.tsx";

import type { SectionFact } from "../knowledge-api.ts";
import { actionNamed, GUIDE_KEYSTROKES, SECTION_ACTIONS } from "./guide-state.ts";
import { GUIDE_WORDS as WORDS } from "./guide-words.ts";

export type Gaps = {
  readonly met: number;
  readonly of: number;
  readonly unmet: readonly SectionFact[];
  readonly owner: string | undefined;
  readonly hrefOf: (fact: SectionFact) => string;
  readonly canInclude: boolean;
  readonly including: boolean;
  readonly onInclude: () => void;
  readonly onAdd: (href: string) => void;
};

function Missing(properties: { readonly fact: SectionFact; readonly gaps: Gaps }) {
  const { fact, gaps } = properties;
  const textId = useId();
  const href = gaps.hrefOf(fact);
  return (
    <>
      <span id={textId}>{WORDS.missing(fact.name, gaps.owner)}</span>
      <RowLink
        href={href}
        {...actionNamed(SECTION_ACTIONS.addFact)}
        aria-describedby={textId}
        aria-keyshortcuts={GUIDE_KEYSTROKES.addFact.key}
        className={buttonVariants({ variant: "outline", size: "sm" })}
        onOpen={() => {
          gaps.onAdd(href);
        }}
      >
        {WORDS.addFact}
      </RowLink>
    </>
  );
}

function IncludeAll(properties: { readonly gaps: Gaps }) {
  const { gaps } = properties;
  if (!gaps.canInclude || !gaps.unmet.some((fact) => fact.state === "available")) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-3"
      aria-disabled={gaps.including}
      onClick={gaps.onInclude}
    >
      {WORDS.include}
    </Button>
  );
}

export function Coverage(properties: { readonly gaps: Gaps }) {
  const { gaps } = properties;
  return (
    <div className="mt-6">
      <p className="font-medium">
        {gaps.of === 0 ? WORDS.noFacts : WORDS.total(gaps.met, gaps.of)}
      </p>
      {gaps.unmet.length === 0 ? null : (
        <ul className="mt-2 grid gap-3">
          {gaps.unmet.map((fact) => (
            <li
              key={fact.factId}
              data-fact={fact.factId}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-2"
            >
              {fact.state === "missing" ? (
                <Missing fact={fact} gaps={gaps} />
              ) : (
                <span>{WORDS.available(fact.name)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <IncludeAll gaps={gaps} />
    </div>
  );
}
