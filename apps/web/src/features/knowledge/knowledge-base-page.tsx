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
  useBranch,
  useKnowledgeTree,
  type Branch,
  type BranchConcept,
  type CollectionCounted,
} from "./knowledge-api.ts";
import {
  heldOf,
  KNOWLEDGE_BASE_FIELDS,
  KNOWLEDGE_BASE_KEYSTROKES as KEY,
  KNOWLEDGE_BASE_LIST,
  openedAt,
  type Opened,
} from "./knowledge-state.ts";
import { KnowledgeTree, type TreeWords } from "./knowledge-tree.tsx";
import { KNOWLEDGE_BASE_WORDS as WORDS } from "./knowledge-words.ts";

const KNOWLEDGE_BASE = pageNamed(BROWSE, "Knowledge Base");

const LISTED = Object.values(KEY);

const TREE_WORDS: TreeWords = {
  name: WORDS.tree,
  collection: WORDS.collection,
  labelled: WORDS.labelled,
};

const NONE: readonly CollectionCounted[] = [];

const totalOf = (collections: readonly CollectionCounted[]): number =>
  collections.reduce((sum, held) => sum + held.count, 0);

const kindCountOf = (
  collections: readonly CollectionCounted[],
  opened: Opened,
): number | undefined =>
  opened === undefined
    ? undefined
    : collections
        .find((held) => held.collection === opened.collection)
        ?.kinds.find((counted) => counted.kind === opened.kind)?.count;

const useOpened = () => {
  const { state, write } = useListAddress(KNOWLEDGE_BASE_LIST, KNOWLEDGE_BASE_FIELDS);
  return {
    opened: openedAt(state),
    open: (collection: string | null, kind: string) => {
      write(heldOf(collection, kind));
    },
  };
};

type Read = (concept: BranchConcept, page: string) => void;

const useRead = (): Read => {
  const openMatch = useOpenMatch();
  return useCallback(
    (concept, page) => {
      openMatch(conceptMatchKey(concept.iri), page, undefined);
    },
    [openMatch],
  );
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

const column = createColumnHelper<typeof features, BranchConcept>();

function TitleCell(properties: {
  readonly concept: BranchConcept;
  readonly landsHere: boolean;
  readonly onLanded: () => void;
  readonly onRead: Read;
}) {
  const { concept, onRead } = properties;
  const land = useLandingLine(properties.landsHere, properties.onLanded);
  const page = conceptPageOf(concept.iri);
  if (page === undefined) return <span className="font-medium wrap-anywhere">{concept.title}</span>;
  return (
    <RowLink
      ref={land}
      href={page}
      onOpen={() => {
        onRead(concept, page);
      }}
    >
      {concept.title}
    </RowLink>
  );
}

const columnsOf = (landAt: number | undefined, onLanded: () => void, onRead: Read) =>
  column.columns([
    column.accessor("title", {
      header: WORDS.columns.title,
      cell: ({ row }) => (
        <TitleCell
          concept={row.original}
          landsHere={row.index === landAt}
          onLanded={onLanded}
          onRead={onRead}
        />
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
  readonly branch: Branch;
  readonly focusAfterRetry: RefObject<HTMLHeadingElement | null>;
}) {
  const { branch } = properties;
  const { landAt, landed, landOn } = useLanding();
  const onRead = useRead();
  const shown = useMemo(
    () => branch.data?.pages.flatMap((page) => page.concepts) ?? [],
    [branch.data],
  );
  const columns = useMemo(() => columnsOf(landAt, landed, onRead), [landAt, landed, onRead]);
  const table = useTable({ features, columns, data: shown, getRowId: (concept) => concept.iri });
  const [hidden] = useHiddenColumns(NARROW_HIDES);

  if (branch.isPending) {
    return <ListState state={{ kind: "loading", words: WORDS.conceptsLoading }} />;
  }
  if (branch.data === undefined) {
    return (
      <ListState
        state={{
          kind: "failed",
          words: failedReadWords(branch.error),
          onRetry: () => {
            void branch.refetch();
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
          more: branch.hasNextPage,
          loading: branch.isFetchingNextPage,
          failed: branch.isFetchNextPageError ? failedReadWords(branch.error) : undefined,
          onMore: () => {
            landOn(shown.length);
            void branch.fetchNextPage();
          },
          keystroke: KEY.more,
        }}
      />
    </>
  );
}

const keyOf = (opened: Opened): string => JSON.stringify(opened ?? null);

function Concepts(properties: {
  readonly opened: Opened;
  readonly count: number;
  readonly branch: Branch;
}) {
  const { opened } = properties;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useKeystroke(KEY.concepts, () => {
    heading.current?.focus();
  });
  const named =
    opened === undefined ? WORDS.concepts : WORDS.kindIn(opened.kind, opened.collection);

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="px-4 pt-3 pb-2">
        <h3 ref={heading} id={headingId} tabIndex={-1} className="font-medium">
          {named}
        </h3>
        <output className="block text-muted-foreground">
          {opened === undefined ? "" : WORDS.count(properties.count)}
        </output>
      </div>
      {opened === undefined ? (
        <ListState state={{ kind: "empty", words: WORDS.openAKind, action: null }} />
      ) : (
        <ConceptRows
          key={keyOf(opened)}
          caption={named}
          branch={properties.branch}
          focusAfterRetry={heading}
        />
      )}
    </section>
  );
}

function Browsed(properties: {
  readonly collections: readonly CollectionCounted[];
  readonly opened: Opened;
  readonly onOpen: (collection: string | null, kind: string) => void;
  readonly branch: Branch;
}) {
  const { collections, opened } = properties;
  const tabStopRef = useTabStop();
  if (collections.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: null }} />;
  }
  const count = kindCountOf(collections, opened);

  return (
    <div className="@container">
      <div className="grid @2xl:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
        <div className="border-b border-border p-2 @2xl:border-r @2xl:border-b-0">
          <KnowledgeTree
            collections={collections}
            opened={opened}
            onOpen={properties.onOpen}
            words={TREE_WORDS}
            tabStopRef={tabStopRef}
          />
        </div>
        <Concepts
          opened={count === undefined ? undefined : opened}
          count={count ?? 0}
          branch={properties.branch}
        />
      </div>
    </div>
  );
}

function KnowledgeBaseRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const tree = useKnowledgeTree();
  const { opened, open } = useOpened();
  const branch = useBranch(opened);
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
          <Browsed
            collections={collections ?? NONE}
            opened={opened}
            onOpen={open}
            branch={branch}
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
      <PageHead heading={BROWSE.name} summary={BROWSE.summary} />
      <KnowledgeBaseRegion />
    </>
  );
}
