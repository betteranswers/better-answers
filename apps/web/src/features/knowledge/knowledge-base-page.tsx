import { useRouterState } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useCallback, useId, useMemo, useRef, useState, type RefObject } from "react";

import { useListAddress } from "@/shared/address/list-address.ts";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { KNOWLEDGE_BASE_PAGE, RETURNED_TO } from "@/shared/knowledge/concept-address.ts";
import { ConceptLink } from "@/shared/knowledge/concept-link.tsx";
import { failedReadWords } from "@/shared/knowledge/refusal.tsx";
import { TrustMark } from "@/shared/knowledge/trust-mark.tsx";
import { useLanding, useLandingLine } from "@/shared/landing.ts";
import { GridTable } from "@/shared/list/grid-table.tsx";
import { ListPages, ListRead, ListState } from "@/shared/list/list-pages.tsx";
import { ListHead, PageHead } from "@/shared/page/page-head.tsx";
import { Card } from "@/shared/ui/card.tsx";

import {
  useConceptsOfType,
  useKnowledgeTree,
  type CollectionCounted,
  type ConceptOfType,
  type ConceptsOfTypeRead,
} from "./knowledge-api.ts";
import {
  heldOf,
  KNOWLEDGE_BASE_FIELDS,
  KNOWLEDGE_BASE_KEYSTROKES as KEY,
  KNOWLEDGE_BASE_LIST,
  openConceptTypeAt,
  type OpenConceptType,
} from "./knowledge-state.ts";
import {
  initiallyExpanded,
  KnowledgeTree,
  largestConceptType,
  toggled,
} from "./knowledge-tree.tsx";
import { KNOWLEDGE_BASE_WORDS as WORDS } from "./knowledge-words.ts";

const LISTED = Object.values(KEY);

const NONE: readonly CollectionCounted[] = [];

type ShownConceptType = {
  readonly collection: string | null;
  readonly conceptType: string;
  readonly count: number;
};

const totalOf = (collections: readonly CollectionCounted[]): number =>
  collections.reduce((sum, held) => sum + held.count, 0);

const shownConceptTypeOf = (
  collections: readonly CollectionCounted[],
  open: OpenConceptType,
): ShownConceptType | undefined => {
  if (open === undefined) return undefined;
  const count = collections
    .find((held) => held.collection === open.collection)
    ?.conceptTypes.find((counted) => counted.conceptType === open.conceptType)?.count;
  return count === undefined ? undefined : { ...open, count };
};

const useOpenConceptType = () => {
  const { state, write } = useListAddress(KNOWLEDGE_BASE_LIST, KNOWLEDGE_BASE_FIELDS);
  return {
    open: openConceptTypeAt(state),
    openConceptType: (collection: string | null, conceptType: string) => {
      write(heldOf(collection, conceptType));
    },
  };
};

const useTabStop = () => {
  const tabStop = useRef<HTMLDivElement | null>(null);
  const returned = useRouterState({
    select: (state) => RETURNED_TO.safeParse(state.location.state).data?.openedMatch !== undefined,
  });
  const [returning, setReturning] = useState(returned);
  const land = useLandingLine(
    returning,
    useCallback(() => {
      setReturning(false);
    }, []),
  );
  useKeystroke(KEY.tree, () => {
    tabStop.current?.focus();
  });
  return useCallback(
    (item: HTMLDivElement | null) => {
      tabStop.current = item;
      land(item);
    },
    [land],
  );
};

const features = tableFeatures({});

const column = createColumnHelper<typeof features, ConceptOfType>();

const columnsOf = (landAt: number | undefined, onLanded: () => void) =>
  column.columns([
    column.accessor("title", {
      header: WORDS.columns.title,
      cell: ({ row }) => (
        <ConceptLink concept={row.original} landsHere={row.index === landAt} onLanded={onLanded} />
      ),
    }),
    column.accessor("trustWords", {
      header: WORDS.columns.trust,
      cell: ({ row }) => <TrustMark trust={row.original.trust} words={row.original.trustWords} />,
    }),
  ]);

function ConceptRows(properties: {
  readonly caption: string;
  readonly read: ConceptsOfTypeRead;
  readonly focusAfterRetry: RefObject<HTMLHeadingElement | null>;
}) {
  const { read } = properties;
  const { landAt, landed, landOn } = useLanding();
  const listed = useMemo(
    () => read.data?.pages.flatMap((page) => page.concepts) ?? [],
    [read.data],
  );
  const columns = useMemo(() => columnsOf(landAt, landed), [landAt, landed]);
  const table = useTable({ features, columns, data: listed, getRowId: (concept) => concept.iri });

  if (read.isPending) {
    return <ListState state={{ kind: "loading", words: WORDS.conceptsLoading }} />;
  }
  if (read.data === undefined) {
    return (
      <ListState
        state={{
          kind: "failed",
          words: failedReadWords(read.error),
          onRetry: () => {
            void read.refetch();
          },
          focusAfterRetry: properties.focusAfterRetry,
        }}
      />
    );
  }
  return (
    <>
      <GridTable
        table={table}
        caption={properties.caption}
        empty={<ListState state={{ kind: "empty", words: WORDS.noneOfTheType, action: null }} />}
      />
      <ListPages
        pages={{
          kind: "more",
          label: WORDS.more,
          more: read.hasNextPage,
          loading: read.isFetchingNextPage,
          failed: read.isFetchNextPageError ? failedReadWords(read.error) : undefined,
          onMore: () => {
            landOn(listed.length);
            void read.fetchNextPage();
          },
          keystroke: KEY.more,
        }}
      />
    </>
  );
}

function Concepts(properties: {
  readonly shown: ShownConceptType | undefined;
  readonly browsing: boolean;
  readonly read: ConceptsOfTypeRead;
}) {
  const { shown } = properties;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useKeystroke(KEY.concepts, () => {
    heading.current?.focus();
  });
  const named =
    shown === undefined ? WORDS.concepts : WORDS.conceptTypeIn(shown.conceptType, shown.collection);

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="px-4 pt-3 pb-2">
        <h3 ref={heading} id={headingId} tabIndex={-1} className="font-medium">
          {named}
        </h3>
        <output className="block text-muted-foreground">
          {shown === undefined ? "" : WORDS.count(shown.count)}
        </output>
      </div>
      {shown === undefined ? (
        <ListState
          state={{
            kind: "empty",
            words: properties.browsing ? WORDS.chooseAType : WORDS.openACollection,
            action: null,
          }}
        />
      ) : (
        <ConceptRows
          key={JSON.stringify([shown.collection, shown.conceptType])}
          caption={named}
          read={properties.read}
          focusAfterRetry={heading}
        />
      )}
    </section>
  );
}

function Browsed(properties: {
  readonly collections: readonly CollectionCounted[];
  readonly open: OpenConceptType;
  readonly onOpen: (collection: string | null, conceptType: string) => void;
  readonly read: ConceptsOfTypeRead;
}) {
  const { collections, open } = properties;
  const tabStopRef = useTabStop();
  const [expanded, setExpanded] = useState(() => initiallyExpanded(open));
  if (collections.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: null }} />;
  }

  return (
    <div className="@container">
      <div className="grid @2xl:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
        <div className="border-b border-border p-2 @2xl:border-r @2xl:border-b-0">
          <KnowledgeTree
            collections={collections}
            open={open}
            onOpen={properties.onOpen}
            expanded={expanded}
            onToggle={(collection) => {
              setExpanded((held) => toggled(held, collection));
            }}
            tabStopRef={tabStopRef}
          />
        </div>
        <Concepts
          shown={shownConceptTypeOf(collections, open)}
          browsing={expanded.size > 0}
          read={properties.read}
        />
      </div>
    </div>
  );
}

function KnowledgeBaseRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const tree = useKnowledgeTree();
  const { open: addressed, openConceptType } = useOpenConceptType();
  const collections = tree.data?.collections;
  const open =
    addressed ?? (collections === undefined ? undefined : largestConceptType(collections));
  const read = useConceptsOfType(open);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={KNOWLEDGE_BASE_PAGE.name}
        headingId={headingId}
        headingRef={heading}
        count={collections === undefined ? "" : WORDS.count(totalOf(collections))}
      />
      <Card marks className="mt-4">
        <ListRead
          read={tree}
          loading={WORDS.loading}
          failed={failedReadWords}
          focusAfterRetry={heading}
        >
          <Browsed
            collections={collections ?? NONE}
            open={open}
            onOpen={openConceptType}
            read={read}
          />
        </ListRead>
      </Card>
    </section>
  );
}

export function KnowledgeBasePage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead title={KNOWLEDGE_BASE_PAGE.name} />
      <KnowledgeBaseRegion />
    </>
  );
}
