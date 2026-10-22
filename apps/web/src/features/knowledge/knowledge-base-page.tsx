import { useRouterState } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useCallback, useId, useMemo, useRef, useState, type RefObject } from "react";

import { GridTable, RowLink } from "@/shared/grid-table.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import {
  BROWSE,
  conceptMatchKey,
  conceptPageOf,
  RETURNED_TO,
} from "@/shared/knowledge/concept-address.ts";
import { useOpenMatch } from "@/shared/knowledge/open-match.ts";
import { failedReadWords } from "@/shared/knowledge/refusal.tsx";
import { useLanding, useLandingLine } from "@/shared/landing.ts";
import { useListAddress } from "@/shared/list-address.ts";
import { ListPages, ListRead, ListState } from "@/shared/list-pages.tsx";
import { pageNamed } from "@/shared/navigation.ts";
import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { useHiddenColumns } from "@/shared/wide-layout.ts";

import {
  useKindConcepts,
  useKnowledgeTree,
  type CollectionCounted,
  type KindConcept,
  type KindConceptsRead,
} from "./knowledge-api.ts";
import {
  heldOf,
  KNOWLEDGE_BASE_FIELDS,
  KNOWLEDGE_BASE_KEYSTROKES as KEY,
  KNOWLEDGE_BASE_LIST,
  openKindAt,
  type OpenKind,
} from "./knowledge-state.ts";
import { KnowledgeTree } from "./knowledge-tree.tsx";
import { KNOWLEDGE_BASE_WORDS as WORDS } from "./knowledge-words.ts";

const KNOWLEDGE_BASE = pageNamed(BROWSE, "Knowledge Base");

const LISTED = Object.values(KEY);

const NONE: readonly CollectionCounted[] = [];

type ShownKind = {
  readonly collection: string | null;
  readonly kind: string;
  readonly count: number;
};

const totalOf = (collections: readonly CollectionCounted[]): number =>
  collections.reduce((sum, held) => sum + held.count, 0);

const shownKindOf = (
  collections: readonly CollectionCounted[],
  open: OpenKind,
): ShownKind | undefined => {
  if (open === undefined) return undefined;
  const count = collections
    .find((held) => held.collection === open.collection)
    ?.kinds.find((counted) => counted.kind === open.kind)?.count;
  return count === undefined ? undefined : { ...open, count };
};

const useOpenKind = () => {
  const { state, write } = useListAddress(KNOWLEDGE_BASE_LIST, KNOWLEDGE_BASE_FIELDS);
  return {
    open: openKindAt(state),
    openKind: (collection: string | null, kind: string) => {
      write(heldOf(collection, kind));
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

const column = createColumnHelper<typeof features, KindConcept>();

function TitleCell(properties: {
  readonly concept: KindConcept;
  readonly landsHere: boolean;
  readonly onLanded: () => void;
}) {
  const { concept } = properties;
  const openMatch = useOpenMatch();
  const land = useLandingLine(properties.landsHere, properties.onLanded);
  const page = conceptPageOf(concept.iri);
  if (page === undefined) return <span className="font-medium wrap-anywhere">{concept.title}</span>;
  return (
    <RowLink
      ref={land}
      href={page}
      onOpen={() => {
        openMatch({ key: conceptMatchKey(concept.iri), page });
      }}
    >
      {concept.title}
    </RowLink>
  );
}

const columnsOf = (landAt: number | undefined, onLanded: () => void) =>
  column.columns([
    column.accessor("title", {
      header: WORDS.columns.title,
      cell: ({ row }) => (
        <TitleCell concept={row.original} landsHere={row.index === landAt} onLanded={onLanded} />
      ),
    }),
    column.accessor("kind", {
      header: WORDS.columns.kind,
      cell: ({ getValue }) => getValue(),
    }),
    column.accessor("trustWords", {
      header: WORDS.columns.trust,
      cell: ({ getValue }) => <Pill>{getValue()}</Pill>,
    }),
  ]);

const NARROW_HIDES: ReadonlySet<string> = new Set(["kind"]);

function ConceptRows(properties: {
  readonly caption: string;
  readonly read: KindConceptsRead;
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
  const [hidden] = useHiddenColumns(NARROW_HIDES);

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
        hidden={hidden}
        empty={<ListState state={{ kind: "empty", words: WORDS.noneOfTheKind, action: null }} />}
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
  readonly shown: ShownKind | undefined;
  readonly read: KindConceptsRead;
}) {
  const { shown } = properties;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useKeystroke(KEY.concepts, () => {
    heading.current?.focus();
  });
  const named = shown === undefined ? WORDS.concepts : WORDS.kindIn(shown.kind, shown.collection);

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
        <ListState state={{ kind: "empty", words: WORDS.openAKind, action: null }} />
      ) : (
        <ConceptRows
          key={JSON.stringify([shown.collection, shown.kind])}
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
  readonly open: OpenKind;
  readonly onOpen: (collection: string | null, kind: string) => void;
  readonly read: KindConceptsRead;
}) {
  const { collections, open } = properties;
  const tabStopRef = useTabStop();
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
            tabStopRef={tabStopRef}
          />
        </div>
        <Concepts shown={shownKindOf(collections, open)} read={properties.read} />
      </div>
    </div>
  );
}

function KnowledgeBaseRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const tree = useKnowledgeTree();
  const { open, openKind } = useOpenKind();
  const read = useKindConcepts(open);
  const collections = tree.data?.collections;

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={KNOWLEDGE_BASE.name}
        headingId={headingId}
        headingRef={heading}
        description={WORDS.about}
        count={collections === undefined ? "" : WORDS.count(totalOf(collections))}
      />
      <Card marks className="mt-4">
        <ListRead
          read={tree}
          loading={WORDS.loading}
          failed={failedReadWords}
          focusAfterRetry={heading}
        >
          <Browsed collections={collections ?? NONE} open={open} onOpen={openKind} read={read} />
        </ListRead>
      </Card>
    </section>
  );
}

export function KnowledgeBasePage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead heading={BROWSE.name} summary={BROWSE.summary} />
      <KnowledgeBaseRegion />
    </>
  );
}
