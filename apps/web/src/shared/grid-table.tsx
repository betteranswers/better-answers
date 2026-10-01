import {
  flexRender,
  type Header,
  type Row,
  type RowData,
  type Table as HeldTable,
  type TableFeatures,
} from "@tanstack/react-table";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table.tsx";

/** Ticks are row ids the screen holds, so a row a search or a page hides stays ticked. */
type Ticks = {
  readonly ticked: ReadonlySet<string>;
  readonly onTickedChange: (ticked: ReadonlySet<string>) => void;
  readonly everyOnThePage: string;
};

type Ticking<Data> = Ticks & { readonly nameOf: (row: Data) => string };

type ColumnSort = { readonly id: string; readonly desc: boolean };

type SortHeads = {
  readonly sortable: ReadonlySet<string>;
  readonly sorted: ColumnSort | undefined;
  readonly onSortedChange: (sorted: ColumnSort) => void;
};

type Opted<Data> = {
  readonly ticking?: Ticking<Data> | undefined;
  readonly sorting?: SortHeads | undefined;
  readonly hidden?: ReadonlySet<string> | undefined;
  readonly rowMenu?: ((row: Data) => ReactNode) | undefined;
};

const HEAD =
  "h-9 px-3 font-medium whitespace-normal text-muted-foreground [font-size:var(--text-xs)]";

/** Wrapping, not scrolling, is what keeps a 320px screen from hiding a column. */
const CELL = "h-10 px-3 py-2 whitespace-normal";

/**
 * The drawn box is 16px; a press needs 24px. Centred, not inset, since an inset counts from inside
 * the border.
 */
const TICK =
  "relative after:absolute after:top-1/2 after:left-1/2 after:size-6 after:-translate-x-1/2 after:-translate-y-1/2";

const opensElsewhere = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/** A link the caller sent to another window, or to a download, is the browser's to follow. */
const leavesThePage = (link: HTMLAnchorElement): boolean =>
  !["", "_self"].includes(link.target) || link.hasAttribute("download");

/** A real link, so a new tab or a copied address still reaches the row; a plain click opens it here. */
export function RowLink(
  properties: Omit<ComponentProps<"a">, "href" | "onClick"> & {
    readonly href: string;
    readonly onOpen: () => void;
  },
) {
  const { href, onOpen, className, children, ...link } = properties;
  return (
    <a
      {...link}
      href={href}
      className={cn(
        "font-medium text-foreground underline-offset-4 wrap-anywhere hover:underline",
        className,
      )}
      onClick={(event) => {
        if (opensElsewhere(event) || leavesThePage(event.currentTarget)) return;
        event.preventDefault();
        onOpen();
      }}
    >
      {children}
    </a>
  );
}

const withEach = (
  ticked: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): ReadonlySet<string> => {
  const next = new Set(ticked);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
};

const pageTickState = (ticked: ReadonlySet<string>, ids: readonly string[]) => {
  const count = ids.filter((id) => ticked.has(id)).length;
  if (count === 0) return false;
  return count === ids.length ? true : "indeterminate";
};

/** Ticks the rows this page shows and no others; a tick on another page stands. */
function PageTick(properties: { readonly ids: readonly string[]; readonly ticking: Ticks }) {
  const { ids, ticking } = properties;
  return (
    <Checkbox
      aria-label={ticking.everyOnThePage}
      className={TICK}
      checked={pageTickState(ticking.ticked, ids)}
      disabled={ids.length === 0}
      onCheckedChange={(checked) => {
        ticking.onTickedChange(withEach(ticking.ticked, ids, checked === true));
      }}
    />
  );
}

function SortHead(properties: {
  readonly sorted: ColumnSort | undefined;
  readonly onSort: () => void;
  readonly children: ReactNode;
}) {
  const { sorted } = properties;
  const glyph = sorted?.desc === true ? "sorted-descending" : "sorted-ascending";
  return (
    <button
      type="button"
      className="-mx-1 inline-flex min-h-6 items-center gap-1 px-1 text-left hover:text-foreground"
      onClick={properties.onSort}
    >
      {properties.children}
      <Icon name={sorted === undefined ? "unsorted" : glyph} className="size-3" />
    </button>
  );
}

const ariaSortOf = (sorted: ColumnSort | undefined) => {
  if (sorted === undefined) return "none";
  return sorted.desc ? "descending" : "ascending";
};

/** Ascending first, then each press turns it round; a list always holds some order. */
const nextSort = (sorted: ColumnSort | undefined, id: string): ColumnSort => ({
  id,
  desc: sorted?.id === id && !sorted.desc,
});

function ColumnHead<Features extends TableFeatures, Data extends RowData>(properties: {
  readonly header: Header<Features, Data, unknown>;
  readonly sorting: SortHeads | undefined;
}) {
  const { header, sorting } = properties;
  const label = flexRender(header.column.columnDef.header, header.getContext());
  const id = header.column.id;
  if (sorting === undefined || !sorting.sortable.has(id)) {
    return (
      <TableHead scope="col" className={HEAD}>
        {label}
      </TableHead>
    );
  }
  const sorted = sorting.sorted?.id === id ? sorting.sorted : undefined;
  return (
    <TableHead scope="col" className={HEAD} aria-sort={ariaSortOf(sorted)}>
      <SortHead
        sorted={sorted}
        onSort={() => {
          sorting.onSortedChange(nextSort(sorting.sorted, id));
        }}
      >
        {label}
      </SortHead>
    </TableHead>
  );
}

const isShown = (hidden: ReadonlySet<string> | undefined, columnId: string): boolean =>
  hidden?.has(columnId) !== true;

function GridRow<Features extends TableFeatures, Data extends RowData>(
  properties: Opted<Data> & { readonly row: Row<Features, Data> },
) {
  const { row, ticking, hidden, rowMenu } = properties;
  const ticked = ticking?.ticked.has(row.id) === true;
  return (
    <TableRow
      data-state={ticked ? "selected" : undefined}
      className="border-border data-[state=selected]:bg-[var(--surface-selected)]"
    >
      {ticking === undefined ? null : (
        <TableCell className={cn(CELL, "w-10")}>
          <Checkbox
            aria-label={`Select ${ticking.nameOf(row.original)}`}
            className={TICK}
            checked={ticked}
            onCheckedChange={(checked) => {
              ticking.onTickedChange(withEach(ticking.ticked, [row.id], checked === true));
            }}
          />
        </TableCell>
      )}
      {row
        .getAllCells()
        .filter((cell) => isShown(hidden, cell.column.id))
        .map((cell) => (
          <TableCell key={cell.id} className={CELL}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      {rowMenu === undefined ? null : (
        <TableCell className={cn(CELL, "w-12 py-0 text-right")}>{rowMenu(row.original)}</TableCell>
      )}
    </TableRow>
  );
}

const columnCount = <Features extends TableFeatures, Data extends RowData>(
  table: HeldTable<Features, Data>,
  opted: Opted<Data>,
): number =>
  table.getAllLeafColumns().filter((column) => isShown(opted.hidden, column.id)).length +
  (opted.ticking === undefined ? 0 : 1) +
  (opted.rowMenu === undefined ? 0 : 1);

/**
 * `empty` fills the body when no row is left, so the header still names the columns. An opt-in
 * part left out draws nothing.
 */
export function GridTable<Features extends TableFeatures, Data extends RowData>(
  properties: Opted<Data> & {
    /** Flat columns only: the header draws no spans, so a column group's header would misalign. */
    readonly table: HeldTable<Features, Data>;
    readonly caption: string;
    readonly empty: ReactNode;
  },
) {
  const { table, ticking, sorting, hidden, rowMenu } = properties;
  const rows = table.getRowModel().rows;

  return (
    <Table>
      <TableCaption className="sr-only">{properties.caption}</TableCaption>
      <TableHeader className="bg-muted">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="border-border hover:bg-transparent">
            {ticking === undefined ? null : (
              <TableHead scope="col" className={cn(HEAD, "w-10")}>
                <PageTick ids={rows.map((row) => row.id)} ticking={ticking} />
              </TableHead>
            )}
            {group.headers
              .filter((header) => isShown(hidden, header.column.id))
              .map((header) => (
                <ColumnHead key={header.id} header={header} sorting={sorting} />
              ))}
            {rowMenu === undefined ? null : (
              <TableHead scope="col" className={cn(HEAD, "w-12")}>
                <span className="sr-only">Acts</span>
              </TableHead>
            )}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="border-border hover:bg-transparent">
            <TableCell colSpan={columnCount(table, properties)} className="p-0 whitespace-normal">
              {properties.empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <GridRow key={row.id} row={row} ticking={ticking} hidden={hidden} rowMenu={rowMenu} />
          ))
        )}
      </TableBody>
    </Table>
  );
}
