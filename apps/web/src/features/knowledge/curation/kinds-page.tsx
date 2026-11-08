import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { createContext, useContext, useId, useMemo, useRef, useState, type RefObject } from "react";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { useListAddress } from "@/shared/address/list-address.ts";
import type { ApiError } from "@/shared/api/trpc.ts";
import { Icon } from "@/shared/icon.tsx";
import { useKeystroke, usePageKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { GridTable } from "@/shared/list/grid-table.tsx";
import { ListRead, ListState } from "@/shared/list/list-pages.tsx";
import { onTheRowInFocus, rowInFocus, type Saying } from "@/shared/list/row-focus.ts";
import { ownsNoLonger, useArrivalDecidedAgainOnceUnowned } from "@/shared/member/ownership.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { ListHead, PageHead } from "@/shared/page/page-head.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { CLEAR_WORDS } from "@/shared/words.ts";

import { AddFromSearch } from "../add-from-search.tsx";
import { useKinds, type KindCounted } from "../knowledge-api.ts";
import {
  KINDS_FIELDS,
  KINDS_KEYSTROKES as KEY,
  KINDS_LIST,
  KINDS_TAIL_MAX,
  kindsSortedOf,
  kindsSortOf,
  type KindsSort,
} from "./curation-state.ts";
import { KINDS_WORDS as WORDS } from "./curation-words.ts";

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

const KINDS = pageNamed(CURATION, "Kinds");

const { outcomeOfFailure } = refusalsOf(WORDS.refusals);

const wordsOfFailure = (failure: Error | ApiError) => outcomeOfFailure(failure, "read").words;

const LISTED: readonly Keystroke[] = Object.values(KEY);

const SORTABLE: ReadonlySet<string> = new Set(["kind", "count"]);

const NONE: readonly KindCounted[] = [];

const NONE_OPEN: ReadonlySet<string> = new Set();

const features = tableFeatures({});

const column = createColumnHelper<typeof features, KindCounted>();

const arranged = (
  kinds: readonly KindCounted[],
  sort: KindsSort,
  tail: boolean,
): readonly KindCounted[] => {
  const { id, desc } = kindsSortedOf(sort);
  const direction = desc ? -1 : 1;
  return kinds
    .filter((each) => !tail || each.count <= KINDS_TAIL_MAX)
    .toSorted(
      (one, other) =>
        direction * (id === "count" ? one.count - other.count : byCodeUnit(one.kind, other.kind)) ||
        byCodeUnit(one.kind, other.kind),
    );
};

const toggled = (held: ReadonlySet<string>, kind: string): ReadonlySet<string> => {
  const next = new Set(held);
  if (!next.delete(kind)) next.add(kind);
  return next;
};

type Disclosures = {
  readonly opened: ReadonlySet<string>;
  readonly toggle: (kind: string) => void;
};

const DisclosuresContext = createContext<Disclosures>({
  opened: NONE_OPEN,
  toggle: () => undefined,
});

function KindCell(properties: { readonly kind: KindCounted }) {
  const { kind } = properties;
  const disclosures = useContext(DisclosuresContext);
  const open = disclosures.opened.has(kind.kind);
  return (
    <Collapsible
      open={open}
      onOpenChange={() => {
        disclosures.toggle(kind.kind);
      }}
    >
      <CollapsibleTrigger className="-mx-1 inline-flex min-h-6 items-center gap-1 px-1 text-left font-medium wrap-anywhere hover:underline">
        <Icon name={open ? "caret-down" : "caret-right"} className="text-muted-foreground" />
        {kind.kind}
        <span className="sr-only">{WORDS.byCollection}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 pl-5">
        <ul aria-label={WORDS.collectionsOf(kind.kind)} className="grid max-w-sm gap-1">
          {kind.collections.map((held) => (
            <li key={JSON.stringify(held.collection)} className="flex justify-between gap-4">
              <span className="wrap-anywhere">{held.collection ?? WORDS.noCollection}</span>
              <span className="tabular-nums">{held.count}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

const COLUMNS = column.columns([
  column.accessor("kind", {
    header: WORDS.columns.kind,
    cell: ({ row }) => <KindCell kind={row.original} />,
  }),
  column.accessor("count", {
    header: WORDS.columns.concepts,
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),
]);

function TailSwitch(properties: {
  readonly pressed: boolean;
  readonly onPress: () => void;
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { pressed, onPress, buttonRef } = properties;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        aria-pressed={pressed}
        className="aria-pressed:border-[var(--border-strong)] aria-pressed:bg-accent aria-pressed:font-semibold"
        aria-keyshortcuts={KEY.tail.key}
        onClick={onPress}
      >
        {WORDS.tail}
      </Button>
    </div>
  );
}

type Narrowing = {
  readonly sort: KindsSort;
  readonly tail: boolean;
  readonly onSort: (sort: KindsSort) => void;
  readonly onTail: (tail: boolean) => void;
};

function KindsTable(properties: {
  readonly shown: readonly KindCounted[];
  readonly narrowing: Narrowing;
  readonly say: Saying;
}) {
  const { shown, narrowing, say } = properties;
  const { sort, tail, onSort, onTail } = narrowing;
  const [opened, setOpened] = useState(NONE_OPEN);
  const switchRef = useRef<HTMLButtonElement>(null);
  const disclosures = useMemo<Disclosures>(
    () => ({
      opened,
      toggle: (kind) => {
        setOpened((held) => toggled(held, kind));
      },
    }),
    [opened],
  );
  const table = useTable({
    features,
    columns: COLUMNS,
    data: shown,
    getRowId: (each) => each.kind,
  });

  const acting = onTheRowInFocus(
    () => rowInFocus(shown, (each) => each.kind),
    say,
    selectFirst(WORDS.selectFirst),
  );
  usePageKeystrokes(LISTED);
  useKeystroke(KEY.tail, () => {
    onTail(!tail);
  });
  useKeystroke(
    KEY.open,
    acting((each) => {
      disclosures.toggle(each.kind);
    }),
  );

  return (
    <DisclosuresContext value={disclosures}>
      <TailSwitch
        pressed={tail}
        buttonRef={switchRef}
        onPress={() => {
          onTail(!tail);
        }}
      />
      <GridTable
        table={table}
        caption={WORDS.caption}
        sorting={{
          sortable: SORTABLE,
          sorted: kindsSortedOf(sort),
          onSortedChange: (next) => {
            const picked = kindsSortOf(next);
            if (picked !== undefined) onSort(picked);
          },
        }}
        empty={
          <ListState
            state={{
              kind: "emptied",
              words: WORDS.noneSmall,
              clearWords: CLEAR_WORDS.filters,
              onClear: () => {
                onTail(false);
              },
              focusAfterClear: switchRef,
            }}
          />
        }
      />
    </DisclosuresContext>
  );
}

function KindsRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useKinds();
  useArrivalDecidedAgainOnceUnowned(ownsNoLonger(read.error));
  const { state, write } = useListAddress(KINDS_LIST, KINDS_FIELDS);
  const [outcome, say] = useState<Outcome>();
  const listed = read.data?.kinds ?? NONE;
  const { sort } = state;
  const tail = state.tail === "small";
  const shown = useMemo(() => arranged(listed, sort, tail), [listed, sort, tail]);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={KINDS.name}
        headingId={headingId}
        headingRef={heading}
        count={read.data === undefined ? "" : WORDS.count(shown.length, listed.length)}
      />
      <OutcomeLine outcome={outcome} className="mt-2" />
      <Card marks className="mt-4">
        <ListRead
          read={read}
          loading={WORDS.loading}
          failed={wordsOfFailure}
          focusAfterRetry={heading}
        >
          {listed.length === 0 ? (
            <ListState state={{ kind: "empty", words: WORDS.none, action: <AddFromSearch /> }} />
          ) : (
            <KindsTable
              shown={shown}
              say={say}
              narrowing={{
                sort,
                tail,
                onSort: (next) => {
                  write({ sort: next });
                },
                onTail: (on) => {
                  write({ tail: on ? "small" : undefined });
                },
              }}
            />
          )}
        </ListRead>
      </Card>
    </section>
  );
}

export function KindsPage() {
  return (
    <>
      <PageHead title={KINDS.name} />
      <KindsRegion />
    </>
  );
}
