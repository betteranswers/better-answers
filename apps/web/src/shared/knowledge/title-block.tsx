import type { ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { keyed } from "@/shared/list/keyed.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { dayWords } from "@/shared/words.ts";

import { generatedOf, otherFieldsOf, staleAfterOf } from "./concept-frontmatter.ts";
import { CONCEPT_WORDS } from "./concept-words.ts";
import type { Concept } from "./knowledge-reads.ts";
import { markOf, TONE_CLASSES, TrustMark } from "./trust-mark.tsx";

const WORDS = CONCEPT_WORDS.titleBlock;

type Verification = Concept["verifications"][number];

type Reach = { readonly sources: () => void };

type Row = {
  readonly label: string;
  readonly span: "full" | "half";
  readonly tint?: (concept: Concept) => string;
  /** Null leaves the row out. */
  readonly value: (concept: Concept, reach: Reach) => ReactNode;
};

const MONO = "font-mono [font-size:var(--text-sm)]";

function Quiet(properties: { readonly children: ReactNode }) {
  return <span className="font-normal text-muted-foreground">{properties.children}</span>;
}

function Detail(properties: { readonly children: ReactNode; readonly mono?: true }) {
  return (
    <p
      className={cn(
        "mt-0.5 [font-size:var(--text-xs)] font-normal text-muted-foreground",
        properties.mono === true && "font-mono",
      )}
    >
      {properties.children}
    </p>
  );
}

/** A date the file wrote as it likes: one that is not a date is shown as written. */
const dateWords = (written: string): string =>
  Number.isNaN(Date.parse(written)) ? written : dayWords(written);

const checkerOf = (event: Verification): string =>
  event.tier === "human-reviewed" ? (event.name ?? WORDS.aFormerMember) : WORDS.automatically;

const ROWS: readonly Row[] = [
  {
    label: WORDS.trust,
    span: "full",
    tint: ({ trust }) => TONE_CLASSES[markOf(trust).tone],
    value: ({ trust, trustWords }) => <TrustMark trust={trust} words={trustWords} dated flat />,
  },
  {
    label: WORDS.reference,
    span: "full",
    value: ({ path }) => (
      <span className="font-mono [font-size:var(--text-xs)] font-normal wrap-anywhere">
        {path.replace(/\.md$/u, "")}
      </span>
    ),
  },
  {
    label: WORDS.generatedBy,
    span: "half",
    value: ({ frontmatter }) => {
      const generated = generatedOf(frontmatter);
      if (generated === undefined) return <Quiet>{WORDS.notRecorded}</Quiet>;
      const byAPerson = generated.by.startsWith("human:");
      return (
        <>
          <span className={cn("wrap-anywhere", !byAPerson && MONO)}>
            {byAPerson ? WORDS.aPerson : generated.by}
          </span>
          {generated.at === undefined ? null : <Detail mono>{dateWords(generated.at)}</Detail>}
        </>
      );
    },
  },
  {
    label: WORDS.checkedBy,
    span: "half",
    value: ({ verifications }) => {
      const [latest] = verifications;
      if (latest === undefined) return <Quiet>{WORDS.notCheckedYet}</Quiet>;
      return (
        <>
          <span className="wrap-anywhere">{checkerOf(latest)}</span>
          <Detail mono>{dateWords(latest.at)}</Detail>
        </>
      );
    },
  },
  {
    label: WORDS.history,
    span: "full",
    value: ({ verifications }) => {
      const earlier = verifications.slice(1);
      if (earlier.length === 0) return <Quiet>{WORDS.noEarlierChecks}</Quiet>;
      return (
        <ul className="grid gap-1">
          {keyed(earlier, ({ at, actor }) => `${actor}:${at}`).map(({ key, item }) => (
            <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="wrap-anywhere">{checkerOf(item)}</span>
              <span className={cn(MONO, "font-normal text-muted-foreground")}>
                {dateWords(item.at)}
              </span>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    label: WORDS.status,
    span: "half",
    value: ({ trust }) => WORDS.statuses[trust.status],
  },
  {
    label: WORDS.reviewBy,
    span: "half",
    value: ({ frontmatter, trust }) => {
      const staleAfter = staleAfterOf(frontmatter);
      if (staleAfter === undefined) return <Quiet>{WORDS.notSet}</Quiet>;
      return (
        <span
          className={cn(MONO, trust.status === "out-of-date" && "text-[var(--trust-stale-fg)]")}
        >
          {dateWords(staleAfter)}
        </span>
      );
    },
  },
  {
    label: WORDS.owner,
    span: "half",
    value: ({ owner, collection }) => {
      if (owner === null) return <Quiet>{WORDS.noOwner}</Quiet>;
      return (
        <>
          <span className="wrap-anywhere">{owner.name}</span>
          {owner.via === "collection" && collection !== null ? (
            <Detail>{WORDS.ownerOf(collection)}</Detail>
          ) : null}
        </>
      );
    },
  },
  {
    label: CONCEPT_WORDS.sources,
    span: "half",
    value: ({ evidence }, reach) =>
      evidence.length === 0 ? (
        0
      ) : (
        <Button
          type="button"
          variant="link"
          aria-label={WORDS.goToSources(evidence.length)}
          className="h-auto px-0 py-0 underline"
          onClick={reach.sources}
        >
          {evidence.length}
        </Button>
      ),
  },
  {
    label: WORDS.usedIn,
    span: "full",
    value: ({ usedIn }) => WORDS.used(usedIn.guides, usedIn.answers),
  },
  {
    label: WORDS.otherFields,
    span: "full",
    value: ({ frontmatter }) => {
      const fields = otherFieldsOf(frontmatter);
      if (fields.length === 0) return null;
      return (
        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
            <Icon
              name="caret-right"
              className="size-3.5 transition-transform group-open:rotate-90"
            />
            {WORDS.fields(fields.length)}
          </summary>
          <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
            {fields.map(([key, words]) => (
              <div key={key} className="contents">
                <dt className="font-mono [font-size:var(--text-xs)] text-muted-foreground wrap-anywhere">
                  {key}
                </dt>
                <dd className="font-normal wrap-anywhere">{words}</dd>
              </div>
            ))}
          </dl>
        </details>
      );
    },
  },
];

type Column = "left" | "right" | "both";

type Placed = { readonly row: Row; readonly value: ReactNode; readonly column: Column };

/** A half row takes the left column, the next half row the right, and a full row closes the pair. */
const cellsOf = (concept: Concept, reach: Reach): readonly Placed[] => {
  let waiting = false;
  return ROWS.flatMap((row) => {
    const value = row.value(concept, reach);
    if (value === null) return [];
    const column = row.span === "full" ? "both" : waiting ? "right" : "left";
    waiting = column === "left";
    return [{ row, value, column }];
  });
};

function Cell(properties: {
  readonly row: Row;
  readonly concept: Concept;
  readonly column: Column;
  readonly first: boolean;
  readonly children: ReactNode;
}) {
  const { row, concept, column, first } = properties;
  const tint = row.tint?.(concept);
  return (
    <div
      className={cn(
        "min-w-0 border-t border-border px-3 pt-2 pb-2.5",
        column === "both" && "col-span-2",
        column === "left" && "border-r",
        first && "border-t-0",
        tint,
      )}
    >
      <dt
        className={cn(
          "mb-0.5 [font-size:var(--text-2xs)] font-medium tracking-[var(--tracking-caps)] uppercase",
          tint === undefined ? "text-muted-foreground" : "text-inherit",
        )}
      >
        {row.label}
      </dt>
      <dd className="[font-size:var(--text-base)] font-medium">{properties.children}</dd>
    </div>
  );
}

export function TitleBlock(properties: {
  readonly concept: Concept;
  readonly onGoToSources: () => void;
  readonly className?: string;
}) {
  const { concept } = properties;
  const cells = cellsOf(concept, { sources: properties.onGoToSources });

  return (
    <Card
      asChild
      marks
      className={cn("border-foreground [--mark-ink:var(--text-muted)]", properties.className)}
    >
      <aside aria-label={WORDS.name}>
        <dl className="grid grid-cols-2">
          {cells.map(({ row, value, column }, at) => (
            <Cell key={row.label} row={row} concept={concept} column={column} first={at === 0}>
              {value}
            </Cell>
          ))}
        </dl>
      </aside>
    </Card>
  );
}
