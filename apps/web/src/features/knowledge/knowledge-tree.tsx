import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";

import type { CollectionCounted } from "./knowledge-api.ts";
import type { OpenKind } from "./knowledge-state.ts";
import { KNOWLEDGE_BASE_WORDS as WORDS } from "./knowledge-words.ts";

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

type Collected = { readonly row: CollectionRow; readonly kinds: readonly KindRow[] };

const idOf = (collection: string | null, kind?: string): string =>
  JSON.stringify(kind === undefined ? [collection] : [collection, kind]);

const kindRowsOf = (held: CollectionCounted): readonly KindRow[] =>
  held.kinds.map((counted, place) => ({
    id: idOf(held.collection, counted.kind),
    level: 2,
    name: counted.kind,
    count: counted.count,
    collection: held.collection,
    setsize: held.kinds.length,
    posinset: place + 1,
    kind: counted.kind,
  }));

const outlineOf = (
  collections: readonly CollectionCounted[],
  expanded: ReadonlySet<string | null>,
): readonly Collected[] =>
  collections.map((held, at) => {
    const row: CollectionRow = {
      id: idOf(held.collection),
      level: 1,
      name: WORDS.collection(held.collection),
      count: held.count,
      collection: held.collection,
      setsize: collections.length,
      posinset: at + 1,
      expanded: expanded.has(held.collection),
    };
    return { row, kinds: row.expanded ? kindRowsOf(held) : [] };
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

function Caret(properties: { readonly row: TreeRow }) {
  const { row } = properties;
  if (row.level !== 1) return null;
  return (
    <Icon name={row.expanded ? "caret-down" : "caret-right"} className="text-muted-foreground" />
  );
}

/** axe's label-content-name-mismatch refuses a treeitem whose text holds its child group's names, so a collection owns its group by `aria-owns` instead. */
function TreeItem(properties: {
  readonly row: TreeRow;
  readonly domId: string;
  readonly tabStop: boolean;
  readonly selected: boolean;
  readonly tabStopRef: Ref<HTMLDivElement> | undefined;
  readonly onFocused: () => void;
  readonly onPressed: () => void;
  readonly onKeyed: (event: KeyboardEvent) => void;
  readonly group?: ReactNode;
}) {
  const { row, domId, tabStop, selected, group } = properties;
  const labelId = `${domId}-label`;
  return (
    <li role="none">
      <div
        id={domId}
        role="treeitem"
        aria-level={row.level}
        aria-setsize={row.setsize}
        aria-posinset={row.posinset}
        aria-expanded={row.level === 1 ? row.expanded : undefined}
        aria-selected={row.level === 2 ? selected : undefined}
        aria-owns={group === undefined ? undefined : `${domId}-group`}
        aria-labelledby={labelId}
        tabIndex={tabStop ? 0 : -1}
        ref={tabStop ? properties.tabStopRef : undefined}
        className={cn(
          ROW,
          INDENTS[row.level],
          selected ? "bg-[var(--surface-active)] font-medium" : "hover:bg-accent",
        )}
        onFocus={properties.onFocused}
        onKeyDown={properties.onKeyed}
        onClick={properties.onPressed}
      >
        <Caret row={row} />
        <span id={labelId} className="sr-only">
          {WORDS.labelled(row.name, row.count)}
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

const openIdOf = (open: OpenKind): string | undefined =>
  open === undefined ? undefined : idOf(open.collection, open.kind);

const initiallyExpanded = (open: OpenKind): ReadonlySet<string | null> =>
  new Set(open === undefined ? [] : [open.collection]);

export function KnowledgeTree(properties: {
  readonly collections: readonly CollectionCounted[];
  readonly open: OpenKind;
  readonly onOpen: (collection: string | null, kind: string) => void;
  readonly tabStopRef?: Ref<HTMLDivElement>;
}) {
  const { open, onOpen } = properties;
  const treeId = useId();
  const [expanded, setExpanded] = useState(() => initiallyExpanded(open));
  const [focused, setFocused] = useState(() => openIdOf(open));
  const outline = outlineOf(properties.collections, expanded);
  const rows = outline.flatMap(({ row, kinds }) => [row, ...kinds]);
  const indexOf = new Map(rows.map((row, index) => [row.id, index]));
  const at = indexOf.get(focused ?? "") ?? 0;
  const openId = openIdOf(open);
  const domIdOf = (row: TreeRow): string => `${treeId}-${encodeURIComponent(row.id)}`;

  const take = (step: Step | undefined) => {
    const row = step === undefined ? undefined : rows[step.at];
    if (step === undefined || row === undefined) return;
    setFocused(row.id);
    document.getElementById(domIdOf(row))?.focus();
    if (step.does === "toggle") setExpanded((held) => toggled(held, step.row.collection));
    if (step.does === "open") onOpen(step.row.collection, step.row.kind);
  };

  const drawn = (row: TreeRow, group?: ReactNode) => {
    const index = indexOf.get(row.id) ?? 0;
    return (
      <TreeItem
        key={row.id}
        row={row}
        domId={domIdOf(row)}
        tabStop={index === at}
        selected={row.id === openId}
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
  };

  return (
    <ul role="tree" aria-label={WORDS.tree} className="py-1">
      {outline.map(({ row, kinds }) =>
        drawn(
          row,
          row.expanded ? (
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a tree's group lists a collection's kinds, and no tag this rule offers is a list
            <ul role="group" id={`${domIdOf(row)}-group`}>
              {kinds.map((kind) => drawn(kind))}
            </ul>
          ) : undefined,
        ),
      )}
    </ul>
  );
}
