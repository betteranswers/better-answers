import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useId, useMemo, useRef, useState, type RefObject } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { GridTable } from "@/shared/grid-table.tsx";
import { Icon } from "@/shared/icon.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { MemberSheet, memberButtonId, type OpenedAt } from "./member-sheet.tsx";
import { useMembers, useRemoveMember, type ListedMember } from "./people-api.ts";
import { PEOPLE_KEYSTROKES } from "./people-state.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { GroupPills, JoinedOn, nameOf } from "./words.tsx";

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

const column = createColumnHelper<typeof features, ListedMember>();

const PERSON = "person";

const SEARCH_LABEL = "Search by name or address";

const NOTHING_IN_FOCUS: Outcome = {
  tone: "said",
  words: "Move focus to a member first: the keystroke acts on the member in focus.",
};

const countOfPeople = (count: number): string => (count === 1 ? "1 person" : `${count} people`);

type MemberActs = {
  readonly open: (personId: string) => void;
  readonly focusedOn: (personId: string) => void;
};

function PersonCell(properties: { readonly member: ListedMember; readonly acts: MemberActs }) {
  const { member, acts } = properties;
  const { personId, displayName, address } = member;
  return (
    <span className="flex min-w-0 flex-col items-start leading-tight">
      <Button
        id={memberButtonId(personId)}
        variant="link"
        aria-haspopup="dialog"
        className="h-auto p-0 text-left font-medium whitespace-normal text-foreground"
        onFocus={() => {
          acts.focusedOn(personId);
        }}
        onClick={() => {
          acts.open(personId);
        }}
      >
        {displayName === "" ? (
          <span className="text-muted-foreground">No display name yet</span>
        ) : (
          displayName
        )}
      </Button>
      <span className="text-xs text-muted-foreground wrap-anywhere">{address}</span>
    </span>
  );
}

/** The person's own cell opens them, so its acts ride into the columns. */
const columnsFor = (acts: MemberActs) =>
  column.columns([
    column.accessor((member) => `${member.displayName} ${member.address}`, {
      id: PERSON,
      header: "Person",
      cell: ({ row }) => <PersonCell member={row.original} acts={acts} />,
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
      cell: ({ getValue }) => <JoinedOn instant={getValue()} />,
    }),
  ]);

function NoOneMatches(properties: {
  readonly search: string;
  readonly total: number;
  readonly onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-10">
      <p className="font-medium">No one matches “{properties.search}”.</p>
      <p className="text-muted-foreground">
        Clear the search to see all {countOfPeople(properties.total)}.
      </p>
      <Button variant="outline" className="mt-3" onClick={properties.onClear}>
        Clear the search
      </Button>
    </div>
  );
}

type Opened = { readonly personId: string; readonly at: OpenedAt };

/**
 * The removed row goes before the api answers, so focus lands on the row that took its place, else
 * on the search.
 */
function useRemovalFromTheList(properties: {
  readonly shownIds: () => readonly string[];
  readonly closeTheSheet: () => void;
  readonly setOutcome: (outcome: Outcome | undefined) => void;
  readonly searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { shownIds, closeTheSheet, setOutcome, searchRef } = properties;
  const removeMember = useRemoveMember();
  const landing = useRef<{ readonly personId: string | undefined }>(undefined);

  const remove = (member: ListedMember) => {
    const shown = shownIds();
    const at = shown.indexOf(member.personId);
    landing.current = { personId: shown[at + 1] ?? shown[at - 1] };
    closeTheSheet();
    setOutcome(undefined);
    removeMember.mutate(
      { personId: member.personId },
      {
        onSuccess: () => {
          setOutcome({
            tone: "said",
            words: `${nameOf(member)} is no longer a member of this workspace.`,
          });
        },
        onError: (failure: Error | ApiError) => {
          setOutcome(outcomeOfFailure(failure));
        },
      },
    );
  };

  const returnFocus = (personId: string) => {
    const landsOn = landing.current === undefined ? personId : landing.current.personId;
    landing.current = undefined;
    const row = landsOn === undefined ? null : document.getElementById(memberButtonId(landsOn));
    (row ?? searchRef.current)?.focus();
  };

  return { remove, returnFocus };
}

function MemberList(properties: { readonly members: readonly ListedMember[] }) {
  const { members } = properties;
  const [search, setSearch] = useState("");
  const [inFocus, setInFocus] = useState<string>();
  const [opened, setOpened] = useState<Opened>();
  const [outcome, setOutcome] = useState<Outcome>();
  const searchRef = useRef<HTMLInputElement>(null);

  const columns = useMemo(
    () =>
      columnsFor({
        open: (personId) => {
          setOpened({ personId, at: "member" });
        },
        focusedOn: setInFocus,
      }),
    [],
  );

  const table = useTable({
    features,
    columns,
    data: members,
    getRowId: (member) => member.personId,
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: (candidate) => candidate.id === PERSON,
    state: { globalFilter: search },
  });

  const memberOf = (personId: string | undefined) =>
    members.find((member) => member.personId === personId);

  /** A letter pressed outside the list still needs a member, so the one last in focus stands. */
  const openInFocus = (at: OpenedAt) => {
    const member = memberOf(inFocus);
    setOutcome(member === undefined ? NOTHING_IN_FOCUS : undefined);
    if (member !== undefined) setOpened({ personId: member.personId, at });
  };

  useKeystroke(PEOPLE_KEYSTROKES.search, () => {
    searchRef.current?.focus();
  });
  useKeystroke(PEOPLE_KEYSTROKES.open, () => {
    openInFocus("member");
  });
  useKeystroke(PEOPLE_KEYSTROKES.changeRole, () => {
    openInFocus("role");
  });
  useKeystroke(PEOPLE_KEYSTROKES.revokeCredentials, () => {
    openInFocus("credentials");
  });
  useKeystroke(PEOPLE_KEYSTROKES.remove, () => {
    openInFocus("removal");
  });
  useKeystroke(PEOPLE_KEYSTROKES.flagName, () => {
    openInFocus("name");
  });

  const removal = useRemovalFromTheList({
    shownIds: () => table.getRowModel().rows.map((row) => row.id),
    closeTheSheet: () => {
      setOpened(undefined);
    },
    setOutcome,
    searchRef,
  });

  const clear = () => {
    setSearch("");
    searchRef.current?.focus();
  };

  const shown = table.getRowModel().rows.length;
  const said =
    search === ""
      ? countOfPeople(members.length)
      : `${shown} of ${countOfPeople(members.length)} match “${search}”.`;
  const openedMember = memberOf(opened?.personId);

  return (
    <>
      <output className="mt-1 block text-muted-foreground">{said}</output>
      <OutcomeLine outcome={outcome} className="mt-2" />

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
          caption="Members of this workspace, each with their address, role, groups and the day they joined. A member's name opens them."
          empty={<NoOneMatches search={search} total={members.length} onClear={clear} />}
        />
      </div>

      {opened === undefined || openedMember === undefined ? null : (
        <MemberSheet
          key={opened.personId}
          member={openedMember}
          openedAt={opened.at}
          onClose={() => {
            setOpened(undefined);
          }}
          onRemove={removal.remove}
          returnFocus={() => {
            removal.returnFocus(opened.personId);
          }}
        />
      )}
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
