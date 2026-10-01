import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo, useRef, useState, type RefObject } from "react";

import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable, RowLink } from "@/shared/grid-table.tsx";
import { ListPages, ListState, pageWithin } from "@/shared/list-pages.tsx";
import { RowMenu } from "@/shared/row-menu.tsx";
import { SelectionAct, SelectionBar } from "@/shared/selection-bar.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

type Member = {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly role: string;
  readonly groups: readonly string[];
  readonly joined: string;
};

const ROLES = ["Admin", "Editor", "Viewer"];

/** One name and address long enough to need wrapping at 320 pixels. */
export const MEMBERS: readonly Member[] = [
  {
    id: "cy",
    name: "Cy Twombly",
    address: "cy@marsden-mills.example",
    role: "Viewer",
    groups: ["Finance"],
    joined: "3 March 2026",
  },
  {
    id: "ada",
    name: "Ada Lovelace",
    address: "ada@marsden-mills.example",
    role: "Admin",
    groups: ["Finance", "Site safety"],
    joined: "4 March 2026",
  },
  {
    id: "ed",
    name: "Ed Ruscha",
    address: "ed@marsden-mills.example",
    role: "Editor",
    groups: [],
    joined: "28 September 2026",
  },
  {
    id: "bo",
    name: "Bo Diddley",
    address: "bo@marsden-mills.example",
    role: "Editor",
    groups: ["Site safety"],
    joined: "1 October 2026",
  },
  {
    id: "di",
    name: "Diana Featherstonehaugh-Whittingham",
    address: "diana.featherstonehaugh-whittingham@marsden-mills.example",
    role: "Viewer",
    groups: ["Finance", "Site safety"],
    joined: "1 October 2026",
  },
];

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

const column = createColumnHelper<typeof features, Member>();

const plainColumns = column.columns([
  column.accessor("name", { id: "person", header: "Person" }),
  column.accessor("role", { id: "role", header: "Role" }),
  column.accessor("joined", { id: "joined", header: "Joined" }),
]);

/** Today's shape: a table with none of the opt-in parts. */
export function BareList() {
  const table = useTable({
    features,
    columns: plainColumns,
    data: [...MEMBERS],
    getRowId: (member) => member.id,
  });
  return <GridTable table={table} caption="Members of this workspace." empty={null} />;
}

const NOTHING = () => undefined;

const menuOf = (act: (said: string) => void) => (member: Member) => (
  <RowMenu
    name={member.name}
    acts={[
      {
        label: "Open",
        onSelect: () => {
          act(`open ${member.id}`);
        },
      },
      {
        label: "Remove from workspace",
        destructive: true,
        onSelect: () => {
          act(`remove ${member.id}`);
        },
      },
    ]}
  />
);

const groupedColumns = column.columns([
  column.group({
    id: "person",
    header: "Person",
    columns: column.columns([
      column.accessor("name", { id: "name", header: "Name" }),
      column.accessor("address", { id: "address", header: "Address" }),
    ]),
  }),
  column.accessor("role", { id: "role", header: "Role", sortFn: "alphanumeric" }),
]);

/** A header two rows deep, under a tick and a row menu that each head their column once. */
export function GroupedList(properties: { readonly hidden?: ReadonlySet<string> }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const table = useTable({
    features,
    columns: groupedColumns,
    data: [...MEMBERS],
    getRowId: (member) => member.id,
  });
  return (
    <GridTable
      table={table}
      caption="Members of this workspace."
      ticking={{
        ticked,
        onTickedChange: setTicked,
        nameOf: (member) => member.name,
        everyOnThePage: "Select every member on this page",
      }}
      sorting={{ sortable: new Set(["role"]), sorted: undefined, onSortedChange: NOTHING }}
      hidden={properties.hidden}
      rowMenu={menuOf(NOTHING)}
      empty={null}
    />
  );
}

const linkedColumns = (open: (member: Member) => void) =>
  column.columns([
    column.accessor("name", {
      id: "person",
      header: "Person",
      sortFn: "alphanumeric",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col items-start">
          <RowLink
            href={`/people/members?person=${row.original.id}`}
            onOpen={() => {
              open(row.original);
            }}
          >
            {row.original.name}
          </RowLink>
          <span className="text-xs text-muted-foreground wrap-anywhere">
            {row.original.address}
          </span>
        </span>
      ),
    }),
    column.accessor("role", {
      id: "role",
      header: "Role",
      sortFn: "alphanumeric",
      cell: ({ getValue }) => <Pill>{getValue()}</Pill>,
    }),
    column.accessor("groups", {
      id: "groups",
      header: "Groups",
      cell: ({ getValue }) => (
        <span className="flex flex-wrap gap-1">
          {getValue().map((group) => (
            <Pill key={group}>{group}</Pill>
          ))}
        </span>
      ),
    }),
    column.accessor("joined", { id: "joined", header: "Joined" }),
  ]);

type Asked = {
  readonly members?: readonly Member[];
  readonly pageSize?: number;
  readonly read?: "loading" | "failed" | "ready";
  readonly onRetry?: () => void;
  readonly onAct?: (act: string) => void;
};

type Narrowed = { readonly search: string; readonly role: string | undefined };

type FocusTarget = RefObject<HTMLElement | null>;

const emptyOf = (narrowed: Narrowed, clear: () => void, focusAfterClear: FocusTarget) => {
  if (narrowed.search === "" && narrowed.role === undefined) {
    return (
      <ListState
        state={{
          kind: "empty",
          words: "No one belongs to this workspace yet.",
          act: <Button>Invite people</Button>,
        }}
      />
    );
  }
  const words =
    narrowed.search === ""
      ? "No one matches these filters."
      : `No one matches “${narrowed.search}”.`;
  return <ListState state={{ kind: "emptied", words, onClear: clear, focusAfterClear }} />;
};

const matching = (members: readonly Member[], narrowed: Narrowed): Member[] =>
  members.filter(
    (member) =>
      (narrowed.role === undefined || member.role === narrowed.role) &&
      member.name.toLowerCase().includes(narrowed.search.toLowerCase()),
  );

/** Ticks sit outside the table's rows. Narrowing comes before the table, so the total is known when the page is chosen. */
function useMembersList(asked: Asked) {
  const { members = MEMBERS, pageSize = 25, onAct = NOTHING } = asked;
  const [narrowed, setNarrowed] = useState<Narrowed>({ search: "", role: undefined });
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [sorted, setSorted] = useState<{ readonly id: string; readonly desc: boolean }>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [asksForPage, setPageIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const columns = useMemo(
    () =>
      linkedColumns((member) => {
        onAct(`open ${member.id}`);
      }),
    [onAct],
  );
  const data = matching(members, narrowed);
  const pageIndex = pageWithin(asksForPage, pageSize, data.length);
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (member) => member.id,
    state: {
      sorting: sorted === undefined ? [] : [sorted],
      pagination: { pageIndex, pageSize },
    },
  });
  /** A narrower list starts again from its first page. */
  const narrow = (patch: Partial<Narrowed>) => {
    setNarrowed({ ...narrowed, ...patch });
    setPageIndex(0);
  };
  return {
    onAct,
    narrowed,
    narrow,
    ticked,
    setTicked,
    sorted,
    setSorted,
    hidden,
    setHidden,
    pageIndex,
    setPageIndex,
    pageSize,
    total: data.length,
    searchRef,
    table,
  };
}

type Held = ReturnType<typeof useMembersList>;

const clearFilters = (held: Held) => () => {
  held.narrow({ search: "", role: undefined });
};

function MembersTable(properties: { readonly held: Held }) {
  const { held } = properties;
  return (
    <>
      <GridTable
        table={held.table}
        caption="Members of this workspace."
        ticking={{
          ticked: held.ticked,
          onTickedChange: held.setTicked,
          nameOf: (member) => member.name,
          everyOnThePage: "Select every member on this page",
        }}
        sorting={{
          sortable: new Set(["person", "role"]),
          sorted: held.sorted,
          onSortedChange: held.setSorted,
        }}
        hidden={held.hidden}
        rowMenu={menuOf(held.onAct)}
        empty={emptyOf(held.narrowed, clearFilters(held), held.searchRef)}
      />
      <ListPages
        pages={{
          kind: "pages",
          label: "Pages of members",
          pageIndex: held.pageIndex,
          pageSize: held.pageSize,
          total: held.total,
          onTurn: held.setPageIndex,
        }}
      />
    </>
  );
}

function MembersRead(properties: { readonly asked: Asked; readonly held: Held }) {
  const { read = "ready", onRetry = NOTHING } = properties.asked;
  if (read === "loading") {
    return <ListState state={{ kind: "loading", words: "The members are still loading." }} />;
  }
  if (read === "failed") {
    return (
      <ListState
        state={{
          kind: "failed",
          words: "The members could not be read.",
          onRetry,
          focusAfterRetry: properties.held.searchRef,
        }}
      />
    );
  }
  return <MembersTable held={properties.held} />;
}

/** A Members list as the plan draws it, on every shared part; the browser suite draws it too. */
export function MembersList(properties: Asked) {
  const held = useMembersList(properties);
  const { ticked } = held;

  return (
    <div className="border border-border bg-card">
      <FilterRow
        search={{
          label: "Search by name or address",
          value: held.narrowed.search,
          onChange: (search) => {
            held.narrow({ search });
          },
          inputRef: held.searchRef,
        }}
        filters={[
          {
            label: "Role",
            value: held.narrowed.role,
            anyLabel: "Any role",
            choices: ROLES.map((role) => ({ value: role, label: role })),
            onChange: (role) => {
              held.narrow({ role });
            },
          },
        ]}
        columns={{
          columns: [
            { id: "role", label: "Role" },
            { id: "groups", label: "Groups" },
            { id: "joined", label: "Joined" },
          ],
          hidden: held.hidden,
          onHiddenChange: held.setHidden,
        }}
      />
      <SelectionBar
        label="Selected members"
        ticked={ticked}
        shown={held.table.getRowModel().rows.map((row) => row.id)}
        noun={["member", "members"]}
        clearKeystroke={{ key: "x", act: "Clear the selection" }}
        onClear={() => {
          held.setTicked(new Set());
        }}
        focusAfterClear={held.searchRef}
      >
        <SelectionAct
          onClick={() => {
            held.onAct(`change the role of ${[...ticked].join(", ")}`);
          }}
        >
          Change role
        </SelectionAct>
      </SelectionBar>
      <MembersRead asked={properties} held={held} />
    </div>
  );
}
