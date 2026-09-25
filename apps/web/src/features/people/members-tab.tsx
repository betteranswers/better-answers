import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useId, useRef, useState } from "react";

import { Icon } from "@/shared/icon.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { GridTable } from "./grid-table.tsx";
import { useMembers, type ListedMember } from "./people-api.ts";
import { PEOPLE_KEYSTROKES } from "./people-state.ts";
import { outcomeOfFailure } from "./refusal.tsx";

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

const column = createColumnHelper<typeof features, ListedMember>();

const PERSON = "person";

const SEARCH_LABEL = "Search by name or address";

const JOINED = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

const peopleWord = (count: number): string => (count === 1 ? "1 person" : `${count} people`);

function PersonCell(properties: { readonly member: ListedMember }) {
  const { displayName, address } = properties.member;
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      {displayName === "" ? (
        <span className="text-muted-foreground">No display name yet</span>
      ) : (
        <span className="font-medium text-foreground">{displayName}</span>
      )}
      <span className="text-xs text-muted-foreground wrap-anywhere">{address}</span>
    </span>
  );
}

function GroupPills(properties: { readonly groups: ListedMember["groups"] }) {
  if (properties.groups.length === 0) {
    return <span className="text-muted-foreground">No group</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {properties.groups.map((group) => (
        <Pill key={group.groupId}>{group.name}</Pill>
      ))}
    </span>
  );
}

const COLUMNS = column.columns([
  column.accessor((member) => `${member.displayName} ${member.address}`, {
    id: PERSON,
    header: "Person",
    cell: ({ row }) => <PersonCell member={row.original} />,
  }),
  column.accessor("role", {
    header: "Role",
    cell: ({ getValue }) => <Pill>{getValue()}</Pill>,
  }),
  column.accessor("groups", {
    header: "Groups",
    cell: ({ getValue }) => <GroupPills groups={getValue()} />,
  }),
  column.accessor("joinedAt", {
    header: "Joined",
    cell: ({ getValue }) => (
      <span className="tabular-nums">{JOINED.format(new Date(getValue()))}</span>
    ),
  }),
]);

function NoOneListed(properties: {
  readonly search: string;
  readonly total: number;
  readonly onClear: () => void;
}) {
  if (properties.total === 0) {
    return (
      <div className="px-4 py-10">
        <p className="font-medium">No one belongs to this workspace yet.</p>
        <p className="text-muted-foreground">An invitation, once accepted, brings a person in.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-10">
      <p className="font-medium">No one matches “{properties.search}”.</p>
      <p className="text-muted-foreground">
        Clear the search to see all {peopleWord(properties.total)}.
      </p>
      <Button variant="outline" className="mt-3" onClick={properties.onClear}>
        Clear the search
      </Button>
    </div>
  );
}

function MemberList(properties: { readonly members: readonly ListedMember[] }) {
  const { members } = properties;
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const table = useTable({
    features,
    columns: COLUMNS,
    data: members,
    getRowId: (member) => member.personId,
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: (candidate) => candidate.id === PERSON,
    state: { globalFilter: search },
  });

  useKeystroke(PEOPLE_KEYSTROKES.search, () => {
    searchRef.current?.focus();
  });

  const clear = () => {
    setSearch("");
    searchRef.current?.focus();
  };

  const shown = table.getRowModel().rows.length;
  const said =
    search === ""
      ? peopleWord(members.length)
      : `${shown} of ${peopleWord(members.length)} match “${search}”.`;

  return (
    <>
      <output className="mt-1 block text-muted-foreground">{said}</output>

      <div className="mt-4 border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              aria-label={SEARCH_LABEL}
              aria-keyshortcuts={PEOPLE_KEYSTROKES.search.key}
              placeholder={SEARCH_LABEL}
              className="w-64 pl-8"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || search === "") return;
                event.preventDefault();
                setSearch("");
              }}
            />
          </div>
        </div>

        <GridTable
          table={table}
          caption="Members of this workspace, each with their address, role, groups and the day they joined."
          empty={<NoOneListed search={search} total={members.length} onClear={clear} />}
        />
      </div>
    </>
  );
}

export function MembersTab() {
  const members = useMembers();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId}>Members</h2>
      <OutcomeLine
        outcome={members.error === null ? undefined : outcomeOfFailure(members.error)}
        className="mt-2"
      />
      <div aria-live="polite">
        {members.isPending ? <p className="mt-2">The members are still loading.</p> : null}
      </div>
      {members.data === undefined ? null : <MemberList members={members.data} />}
    </section>
  );
}
