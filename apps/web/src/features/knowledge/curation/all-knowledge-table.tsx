import { useRouterState } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { conceptMatchKey, conceptPageOf, RETURNED_TO } from "@/shared/knowledge/concept-address.ts";
import { useOpenMatch } from "@/shared/knowledge/open-match.ts";
import { GridTable } from "@/shared/list/grid-table.tsx";
import { ListPages, ListState } from "@/shared/list/list-pages.tsx";
import { onTheRowInFocus, rowInFocus } from "@/shared/list/row-focus.ts";
import { SelectionBar } from "@/shared/list/selection-bar.tsx";
import { selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { CLEAR_WORDS } from "@/shared/words.ts";

import { AddFromSearch } from "../add-from-search.tsx";
import type { AllKnowledge, AllKnowledgeRow, useAllKnowledge } from "../knowledge-api.ts";
import type { AllKnowledgeAddress, Standing } from "./all-knowledge-address.ts";
import {
  allKnowledgeColumns,
  allKnowledgeFeatures,
  OpeningContext,
} from "./all-knowledge-columns.tsx";
import { ALL_KNOWLEDGE_KEYSTROKES as KEY, SORTABLE } from "./curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "./curation-words.ts";
import { SetOwnerAction, type useSetOwner } from "./set-owner.tsx";

const NOTHING_IN_FOCUS = selectFirst(WORDS.selectFirst);

const NOTHING_READ: AllKnowledge = { rows: [], total: 0, page: 1, pageSize: 50 };

export const NOTHING_TICKED: ReadonlySet<string> = new Set();

const toggled = (ticked: ReadonlySet<string>, iri: string): ReadonlySet<string> => {
  const next = new Set(ticked);
  if (next.has(iri)) next.delete(iri);
  else next.add(iri);
  return next;
};

const useReturnedTo = () => {
  const returned = useRouterState({
    select: (state) => RETURNED_TO.safeParse(state.location.state).data?.openedMatch,
  });
  const [returnedTo, setReturnedTo] = useState(returned);
  const onLanded = useCallback(() => {
    setReturnedTo(undefined);
  }, []);
  return { returnedTo, onLanded };
};

const useOpenConcept = () => {
  const openMatch = useOpenMatch();
  return useCallback(
    (concept: AllKnowledgeRow) => {
      const page = conceptPageOf(concept.iri);
      if (page !== undefined) openMatch({ key: conceptMatchKey(concept.iri), page });
    },
    [openMatch],
  );
};

const useStayWithinThePages = (
  read: AllKnowledge,
  settled: boolean,
  page: number,
  turnTo: (page: number) => void,
) => {
  const lastPage = Math.max(1, Math.ceil(read.total / read.pageSize));
  const past = settled && page > lastPage;
  const turn = useEffectEvent(() => {
    turnTo(lastPage);
  });
  useEffect(() => {
    if (past) turn();
  }, [past]);
  return Math.min(page, lastPage);
};

function NoConcepts(properties: {
  readonly narrowed: boolean;
  readonly onClear: () => void;
  readonly heading: RefObject<HTMLElement | null>;
}) {
  if (!properties.narrowed) {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: <AddFromSearch /> }} />;
  }
  return (
    <ListState
      state={{
        kind: "emptied",
        words: WORDS.noneMatch,
        clearWords: CLEAR_WORDS.filters,
        onClear: properties.onClear,
        focusAfterClear: properties.heading,
      }}
    />
  );
}

export type Ticks = {
  readonly ticked: ReadonlySet<string>;
  readonly setTicked: Dispatch<SetStateAction<ReadonlySet<string>>>;
};

export function Concepts(properties: {
  readonly standing: Standing;
  readonly address: AllKnowledgeAddress;
  readonly read: ReturnType<typeof useAllKnowledge>;
  readonly ticks: Ticks;
  readonly setOwner: ReturnType<typeof useSetOwner>;
  readonly hidden: ReadonlySet<string>;
  readonly heading: RefObject<HTMLHeadingElement | null>;
  readonly say: Dispatch<SetStateAction<Outcome | undefined>>;
}) {
  const { standing, address, read, ticks, heading } = properties;
  const { admin } = standing;
  const data = read.data ?? NOTHING_READ;
  const page = useStayWithinThePages(
    data,
    read.data !== undefined && !read.isPlaceholderData,
    address.state.page,
    address.turnTo,
  );
  const open = useOpenConcept();
  const { returnedTo, onLanded } = useReturnedTo();
  const opening = useMemo(() => ({ returnedTo, onLanded }), [returnedTo, onLanded]);
  const table = useTable({
    features: allKnowledgeFeatures,
    columns: allKnowledgeColumns,
    data: data.rows,
    getRowId: (concept) => concept.iri,
  });
  const onTheConcept = onTheRowInFocus(
    () => rowInFocus(data.rows, (concept) => concept.iri),
    properties.say,
    NOTHING_IN_FOCUS,
  );
  useKeystroke(KEY.open, onTheConcept(open));
  useKeystroke(
    KEY.tick,
    onTheConcept((concept) => {
      if (admin) ticks.setTicked(toggled(ticks.ticked, concept.iri));
    }),
  );

  return (
    <OpeningContext value={opening}>
      <div aria-busy={read.isPlaceholderData}>
        {admin ? (
          <SelectionBar
            label={WORDS.selected}
            ticked={ticks.ticked}
            shown={data.rows.map((concept) => concept.iri)}
            noun={["concept", "concepts"]}
            clearKeystroke={KEY.clearSelection}
            onClear={() => {
              ticks.setTicked(NOTHING_TICKED);
            }}
            focusAfterClear={heading}
          >
            <SetOwnerAction setOwner={properties.setOwner} />
          </SelectionBar>
        ) : null}
        <GridTable
          table={table}
          caption={WORDS.caption}
          ticking={
            admin
              ? {
                  ticked: ticks.ticked,
                  onTickedChange: ticks.setTicked,
                  nameOf: (concept) => concept.title,
                  everyOnThePage: WORDS.everyOnThePage,
                }
              : undefined
          }
          sorting={{
            sortable: SORTABLE,
            sorted: { id: address.sorted.column, desc: address.sorted.desc },
            onSortedChange: address.sortBy,
          }}
          hidden={properties.hidden}
          empty={
            <NoConcepts
              narrowed={address.narrowed}
              onClear={address.clearFilters}
              heading={heading}
            />
          }
        />
        <ListPages
          pages={{
            kind: "pages",
            label: WORDS.pages,
            pageIndex: page - 1,
            pageSize: data.pageSize,
            total: data.total,
            onTurn: (pageIndex) => {
              address.turnTo(pageIndex + 1);
            },
            keystrokes: { previous: KEY.previousPage, next: KEY.nextPage },
          }}
        />
      </div>
    </OpeningContext>
  );
}
