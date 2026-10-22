import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";

import type { CollectionCounted } from "./knowledge-api.ts";
import type { Opened } from "./knowledge-state.ts";

export type TreeWords = {
  readonly name: string;
  readonly collection: (collection: string | null) => string;
  readonly labelled: (name: string, count: number) => string;
};

type Placed = {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly collection: string | null;
  readonly setsize: number;
  readonly posinset: number;
};

type CollectionRow = Placed & { readonly level: 1; readonly expanded: boolean };

type KindRow = Placed & { readonly level: 2; readonly kind: string };

type TreeRow = CollectionRow | KindRow;

const kindIdOf = (collection: string | null, kind: string): string =>
  JSON.stringify([collection, kind]);

const kindRowsOf = (held: CollectionCounted): readonly KindRow[] =>
  held.kinds.map((counted, place) => ({
    id: kindIdOf(held.collection, counted.kind),
    level: 2,
    name: counted.kind,
    count: counted.count,
    collection: held.collection,
    setsize: held.kinds.length,
    posinset: place + 1,
    kind: counted.kind,
  }));

const rowsOf = (
  collections: readonly CollectionCounted[],
  expanded: ReadonlySet<string | null>,
  words: TreeWords,
): readonly TreeRow[] =>
  collections.flatMap((held, at) => {
    const row: CollectionRow = {
      id: JSON.stringify([held.collection]),
      level: 1,
      name: words.collection(held.collection),
      count: held.count,
      collection: held.collection,
      setsize: collections.length,
      posinset: at + 1,
      expanded: expanded.has(held.collection),
    };
    return row.expanded ? [row, ...kindRowsOf(held)] : [row];
  });

type Step =
  | { readonly does: "focus"; readonly at: number }
  | { readonly does: "toggle"; readonly at: number; readonly row: CollectionRow }
  | { readonly does: "open"; readonly at: number; readonly row: KindRow };

type Keyed = (rows: readonly TreeRow[], at: number) => Step | undefined;

const focusAt = (rows: readonly TreeRow[], at: number): Step => ({
  does: "focus",
  at: Math.min(Math.max(at, 0), rows.length - 1),
});

const pressed: Keyed = (rows, at) => {
  const row = rows[at];
  if (row === undefined) return undefined;
  return row.level === 1 ? { does: "toggle", at, row } : { does: "open", at, row };
};

const rightOf: Keyed = (rows, at) => {
  const row = rows[at];
  if (row?.level !== 1) return undefined;
  return row.expanded ? focusAt(rows, at + 1) : { does: "toggle", at, row };
};

const leftOf: Keyed = (rows, at) => {
  const row = rows[at];
  if (row?.level === 2) {
    return focusAt(
      rows,
      rows.slice(0, at).findLastIndex((each) => each.level === 1),
    );
  }
  return row?.expanded === true ? { does: "toggle", at, row } : undefined;
};

const KEYED: ReadonlyMap<string, Keyed> = new Map<string, Keyed>([
  ["ArrowDown", (rows, at) => focusAt(rows, at + 1)],
  ["ArrowUp", (rows, at) => focusAt(rows, at - 1)],
  ["Home", (rows) => focusAt(rows, 0)],
  ["End", (rows) => focusAt(rows, rows.length - 1)],
  ["ArrowRight", rightOf],
  ["ArrowLeft", leftOf],
  ["Enter", pressed],
]);

const TYPED_AHEAD = /^[\p{L}\p{N}]$/u;

const typedAhead =
  (typed: string): Keyed =>
  (rows, at) => {
    const wanted = typed.toLocaleLowerCase();
    const found = rows
      .map((_row, step) => (at + 1 + step) % rows.length)
      .find((index) => rows[index]?.name.toLocaleLowerCase().startsWith(wanted));
    return found === undefined ? undefined : { does: "focus", at: found };
  };

const keyedBy = (event: KeyboardEvent): Keyed | undefined => {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  return KEYED.get(event.key) ?? (TYPED_AHEAD.test(event.key) ? typedAhead(event.key) : undefined);
};

const toggled = (
  expanded: ReadonlySet<string | null>,
  collection: string | null,
): ReadonlySet<string | null> => {
  const next = new Set(expanded);
  if (!next.delete(collection)) next.add(collection);
  return next;
};

const ROW = "flex min-h-8 cursor-default items-center gap-2 py-1 pr-2 transition-colors";

const INDENTS = { 1: "pl-2", 2: "pl-10" } as const;

type Item = {
  readonly row: TreeRow;
  readonly itemId: string;
  readonly labelId: string;
  readonly groupId: string;
  readonly label: string;
  readonly tabStop: boolean;
  readonly selected: boolean;
};

function Caret(properties: { readonly row: TreeRow }) {
  const { row } = properties;
  if (row.level !== 1) return null;
  return (
    <Icon name={row.expanded ? "caret-down" : "caret-right"} className="text-muted-foreground" />
  );
}

/** axe's label-content-name-mismatch refuses a treeitem whose text holds its child group's names, so a collection owns its group by `aria-owns` instead. */
function TreeItem(properties: {
  readonly item: Item;
  readonly tabStopRef: Ref<HTMLDivElement> | undefined;
  readonly onFocused: () => void;
  readonly onPressed: () => void;
  readonly onKeyed: (event: KeyboardEvent) => void;
  readonly group?: ReactNode;
}) {
  const { item, group } = properties;
  const { row } = item;
  return (
    <li role="none">
      <div
        id={item.itemId}
        role="treeitem"
        aria-level={row.level}
        aria-setsize={row.setsize}
        aria-posinset={row.posinset}
        aria-expanded={row.level === 1 ? row.expanded : undefined}
        aria-selected={row.level === 2 ? item.selected : undefined}
        aria-owns={group === undefined ? undefined : item.groupId}
        aria-labelledby={item.labelId}
        tabIndex={item.tabStop ? 0 : -1}
        ref={item.tabStop ? properties.tabStopRef : undefined}
        className={cn(
          ROW,
          INDENTS[row.level],
          item.selected ? "bg-[var(--surface-active)] font-medium" : "hover:bg-accent",
        )}
        onFocus={properties.onFocused}
        onKeyDown={properties.onKeyed}
        onClick={properties.onPressed}
      >
        <Caret row={row} />
        <span id={item.labelId} className="sr-only">
          {item.label}
        </span>
        <span aria-hidden className="min-w-0 grow wrap-anywhere">
          {row.name}
        </span>{" "}
        <span aria-hidden className="text-muted-foreground tabular-nums">
          {row.count}
        </span>
      </div>
      {group}
    </li>
  );
}

const openedIdOf = (opened: Opened): string | undefined =>
  opened === undefined ? undefined : kindIdOf(opened.collection, opened.kind);

const initiallyExpanded = (opened: Opened): ReadonlySet<string | null> =>
  new Set(opened === undefined ? [] : [opened.collection]);

export function KnowledgeTree(properties: {
  readonly collections: readonly CollectionCounted[];
  readonly opened: Opened;
  readonly onOpen: (collection: string | null, kind: string) => void;
  readonly words: TreeWords;
  readonly tabStopRef?: Ref<HTMLDivElement>;
}) {
  const { opened, onOpen, words } = properties;
  const treeId = useId();
  const [expanded, setExpanded] = useState(() => initiallyExpanded(opened));
  const [focused, setFocused] = useState(() => openedIdOf(opened));
  const rows = rowsOf(properties.collections, expanded, words);
  const at = Math.max(
    0,
    rows.findIndex((row) => row.id === focused),
  );
  const openedId = openedIdOf(opened);
  const itemIdOf = (index: number): string => `${treeId}-${String(index)}`;

  const take = (step: Step | undefined) => {
    if (step === undefined) return;
    setFocused(rows[step.at]?.id);
    document.getElementById(itemIdOf(step.at))?.focus();
    if (step.does === "toggle") setExpanded((held) => toggled(held, step.row.collection));
    if (step.does === "open") onOpen(step.row.collection, step.row.kind);
  };

  const itemOf = (row: TreeRow, index: number): Item => ({
    row,
    itemId: itemIdOf(index),
    labelId: `${itemIdOf(index)}-label`,
    groupId: `${itemIdOf(index)}-group`,
    label: words.labelled(row.name, row.count),
    tabStop: index === at,
    selected: row.id === openedId,
  });

  const placed = rows.map((row, index) => ({ row, index }));
  const kindsOf = Map.groupBy(
    placed.filter(({ row }) => row.level === 2),
    ({ row }) => row.collection,
  );
  const drawn = (row: TreeRow, index: number, group?: ReactNode) => (
    <TreeItem
      key={row.id}
      item={itemOf(row, index)}
      tabStopRef={properties.tabStopRef}
      onFocused={() => {
        setFocused(row.id);
      }}
      onPressed={() => {
        take(pressed(rows, index));
      }}
      onKeyed={(event) => {
        const keyed = keyedBy(event);
        if (keyed === undefined) return;
        event.preventDefault();
        take(keyed(rows, index));
      }}
      group={group}
    />
  );
  const groupOf = (row: TreeRow, index: number): ReactNode =>
    row.level === 1 && row.expanded ? (
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a tree's group lists a collection's kinds, and no tag this rule offers is a list
      <ul role="group" id={itemOf(row, index).groupId}>
        {(kindsOf.get(row.collection) ?? []).map((kind) => drawn(kind.row, kind.index))}
      </ul>
    ) : undefined;

  return (
    <ul role="tree" aria-label={words.name} className="py-1">
      {placed
        .filter(({ row }) => row.level === 1)
        .map(({ row, index }) => drawn(row, index, groupOf(row, index)))}
    </ul>
  );
}
