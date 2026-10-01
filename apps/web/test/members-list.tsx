import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable, RowLink } from "@/shared/grid-table.tsx";
import { ListPages, ListState } from "@/shared/list-pages.tsx";
import { RowMenu } from "@/shared/row-menu.tsx";
import { SelectionBar } from "@/shared/selection-bar.tsx";
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
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
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

const emptyOf = (search: string, clear: () => void) => (
  <ListState
    state={
      search === ""
        ? {
            kind: "empty",
            words: "No one belongs to this workspace yet.",
            act: <Button>Invite people</Button>,
          }
        : { kind: "emptied", words: `No one matches “${search}”.`, onClear: clear }
    }
  />
);

/** What a screen holds and hands the shared parts; ticks sit outside the table's rows. */
function useMembersList(asked: Asked) {
  const { members = MEMBERS, pageSize = 25, onAct = NOTHING } = asked;
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<string>();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [sorted, setSorted] = useState<{ readonly id: string; readonly desc: boolean }>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [pageIndex, setPageIndex] = useState(0);

  const columns = useMemo(
    () =>
      linkedColumns((member) => {
        onAct(`open ${member.id}`);
      }),
    [onAct],
  );
  const table = useTable({
    features,
    columns,
    data: members.filter((member) => role === undefined || member.role === role),
    getRowId: (member) => member.id,
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: (candidate) => candidate.id === "person",
    state: {
      globalFilter: search,
      sorting: sorted === undefined ? [] : [sorted],
      pagination: { pageIndex, pageSize },
    },
  });
  const searchFor = (value: string) => {
    setSearch(value);
    setPageIndex(0);
  };
  return {
    onAct,
    search,
    searchFor,
    role,
    setRole,
    ticked,
    setTicked,
    sorted,
    setSorted,
    hidden,
    setHidden,
    pageIndex,
    setPageIndex,
    pageSize,
    table,
  };
}

type Held = ReturnType<typeof useMembersList>;

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
        empty={emptyOf(held.search, () => {
          held.searchFor("");
        })}
      />
      <ListPages
        pages={{
          kind: "pages",
          label: "Pages of members",
          pageIndex: held.pageIndex,
          pageSize: held.pageSize,
          total: held.table.getFilteredRowModel().rows.length,
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
      <ListState state={{ kind: "failed", words: "The members could not be read.", onRetry }} />
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
          value: held.search,
          onChange: held.searchFor,
        }}
        filters={[
          {
            label: "Role",
            value: held.role,
            anyLabel: "Any role",
            choices: ROLES.map((role) => ({ value: role, label: role })),
            onChange: held.setRole,
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
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            held.onAct(`change the role of ${[...ticked].join(", ")}`);
          }}
        >
          Change role
        </Button>
      </SelectionBar>
      <MembersRead asked={properties} held={held} />
    </div>
  );
}
