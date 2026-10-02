import { useTable } from "@tanstack/react-table";
import { useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { useListAddress } from "@/shared/list-address.ts";
import { ListPages, ListState, pageWithin } from "@/shared/list-pages.tsx";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { RowMenu } from "@/shared/row-menu.tsx";
import { SelectionBar } from "@/shared/selection-bar.tsx";
import { useWideLayout } from "@/shared/wide-layout.ts";

import { useGroups } from "./groups-api.ts";
import { SELECTED_MEMBERS } from "./member-act-words.ts";
import { MemberBulkActs, MemberBulkDialogs, useMemberBulkActs } from "./member-bulk-acts.tsx";
import {
  HIDEABLE,
  memberColumns,
  memberFeatures,
  SORTABLE,
  type RefusedRows,
} from "./member-columns.tsx";
import { MemberSheet, memberButtonId, type OpenedAt } from "./member-sheet.tsx";
import {
  MEMBERS_FIELDS,
  MEMBERS_LIST,
  sortedOf,
  sortOf,
  useSettledSearch,
} from "./members-address.ts";
import {
  useMembers,
  useReaderId,
  useRemoveMember,
  type ListedMember,
  type Role,
} from "./people-api.ts";
import { PEOPLE_KEYSTROKES as KEY } from "./people-state.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { ROLES } from "./role-meanings.ts";
import { useSelfActHome } from "./self-act.tsx";
import { nameOf } from "./words.tsx";

/** The members read returns the whole workspace, so the browser pages it. */
const PAGE_SIZE = 25;

const SEARCH_LABEL = "Search by name or address";

const NOTHING_IN_FOCUS = selectFirst("member");

const NONE: ReadonlySet<string> = new Set();

const NO_ONE: readonly ListedMember[] = [];

const NO_MARKS: RefusedRows = new Map();

/** Person and role are what a narrow screen has room for; the rest can be shown again. */
const NARROW_HIDES: ReadonlySet<string> = new Set(["groups", "joined"]);

const countOfPeople = (count: number): string =>
  count === 1 ? "1 person" : `${String(count)} people`;

type Narrowing = {
  readonly search: string;
  readonly role: Role | undefined;
  readonly group: string | undefined;
};

const isNarrowed = (narrowing: Narrowing): boolean =>
  narrowing.search !== "" || narrowing.role !== undefined || narrowing.group !== undefined;

const saidOfCount = (shown: number, total: number, narrowing: Narrowing): string => {
  if (!isNarrowed(narrowing)) return countOfPeople(total);
  const of = `${String(shown)} of ${countOfPeople(total)} match`;
  return narrowing.search === "" ? `${of} these filters.` : `${of} “${narrowing.search}”.`;
};

const matching =
  (narrowing: Narrowing) =>
  (member: ListedMember): boolean =>
    (narrowing.role === undefined || member.role === narrowing.role) &&
    (narrowing.group === undefined ||
      member.groups.some((group) => group.groupId === narrowing.group)) &&
    `${member.displayName} ${member.address}`
      .toLowerCase()
      .includes(narrowing.search.toLowerCase());

/** Read in render from the address, so Back and a reload come to the same rows. */
const useNarrowedMembers = (listed: readonly ListedMember[]) => {
  const { state, write } = useListAddress(MEMBERS_LIST, MEMBERS_FIELDS);
  const [search, setSearch] = useSettledSearch(state.search, (settled) => {
    write({ search: settled, page: 1 });
  });
  const narrowing: Narrowing = { search, role: state.role, group: state.group };
  const data = listed.filter(matching(narrowing));
  // A search still settling has not reached the address, so it shows its first page.
  const asked = search === state.search ? state.page - 1 : 0;
  const pageIndex = pageWithin(asked, PAGE_SIZE, data.length);

  const clear = () => {
    setSearch("");
    write({ search: "", role: undefined, group: undefined, page: 1 });
  };

  return { state, write, search, setSearch, narrowing, data, pageIndex, clear };
};

type Narrowed = ReturnType<typeof useNarrowedMembers>;

/** A person gone from the list can be acted on no more, so their tick goes with them. */
const useTicks = (listed: readonly ListedMember[]) => {
  const [held, setHeld] = useState<ReadonlySet<string>>(NONE);
  const listedIds: ReadonlySet<string> = new Set(listed.map((member) => member.personId));
  const ticked: ReadonlySet<string> = new Set([...held].filter((id) => listedIds.has(id)));
  return [ticked, setHeld] as const;
};

const toggled = (ticked: ReadonlySet<string>, personId: string): ReadonlySet<string> => {
  const next = new Set(ticked);
  if (next.has(personId)) next.delete(personId);
  else next.add(personId);
  return next;
};

type Opened = { readonly personId: string; readonly at: OpenedAt };

/**
 * The removed row goes before the api answers, so focus lands on the row that took its place,
 * else on the search.
 */
function useRemovalFromTheList(properties: {
  readonly shownIds: () => readonly string[];
  readonly closeTheSheet: () => void;
  readonly setOutcome: (outcome: Outcome | undefined) => void;
  readonly searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { shownIds, closeTheSheet, setOutcome, searchRef } = properties;
  const removeMember = useRemoveMember();
  const readerId = useReaderId();
  const { goHome } = useSelfActHome();
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
          if (member.personId === readerId) void goHome("removed");
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

/** Each of the row's acts opens the member's sheet at that act. */
const ROW_ACTS: readonly { readonly label: string; readonly at: OpenedAt }[] = [
  { label: "Open", at: "member" },
  { label: "Change role", at: "role" },
  { label: "Add to group", at: "groups" },
  { label: "Remove", at: "removal" },
];

const rowMenuOf = (open: (personId: string, at: OpenedAt) => void) => (member: ListedMember) => (
  <RowMenu
    name={nameOf(member)}
    acts={ROW_ACTS.map(({ label, at }) => ({
      label,
      destructive: at === "removal",
      onSelect: () => {
        open(member.personId, at);
      },
    }))}
  />
);

function MemberFilters(properties: {
  readonly narrowed: Narrowed;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly hidden: ReadonlySet<string>;
  readonly onHiddenChange: (hidden: ReadonlySet<string>) => void;
}) {
  const { narrowed, searchRef } = properties;
  const groups = useGroups().data ?? [];
  const groupFilter = {
    label: "Group",
    value: narrowed.state.group,
    anyLabel: "Any group",
    choices: groups.map((group) => ({ value: group.id, label: group.name })),
    onChange: (group: string | undefined) => {
      narrowed.write({ group, page: 1 });
    },
  };
  return (
    <FilterRow
      search={{
        label: SEARCH_LABEL,
        value: narrowed.search,
        onChange: narrowed.setSearch,
        keystroke: KEY.search,
        inputRef: searchRef,
      }}
      filters={[
        {
          label: "Role",
          value: narrowed.state.role,
          anyLabel: "Any role",
          choices: ROLES.map((role) => ({ value: role, label: role })),
          onChange: (role) => {
            narrowed.write({ role: ROLES.find((each) => each === role), page: 1 });
          },
        },
        // A filter with nothing to choose is no filter, so it waits for a group to exist.
        ...(groups.length === 0 ? [] : [groupFilter]),
      ]}
      columns={{
        columns: HIDEABLE,
        hidden: properties.hidden,
        onHiddenChange: properties.onHiddenChange,
      }}
    />
  );
}

/** A failed read stands in for the rows, even stale ones: the reader must not act on them. */
function MembersRead(properties: {
  readonly read: ReturnType<typeof useMembers>;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly children: ReactNode;
}) {
  const { read } = properties;
  if (read.error !== null) {
    return (
      <ListState
        state={{
          kind: "failed",
          words: outcomeOfFailure(read.error, "read").words,
          onRetry: () => {
            void read.refetch();
          },
          focusAfterRetry: properties.searchRef,
        }}
      />
    );
  }
  if (read.data === undefined) {
    return <ListState state={{ kind: "loading", words: "The members are still loading." }} />;
  }
  return properties.children;
}

function NoOneMatches(properties: {
  readonly narrowed: Narrowed;
  readonly focusAfterClear: RefObject<HTMLElement | null>;
}) {
  const { narrowed } = properties;
  return (
    <ListState
      state={{
        kind: "emptied",
        words:
          narrowed.search === ""
            ? "No one matches these filters."
            : `No one matches “${narrowed.search}”.`,
        onClear: narrowed.clear,
        focusAfterClear: properties.focusAfterClear,
      }}
    />
  );
}

function CountLine(properties: {
  readonly read: ReturnType<typeof useMembers>;
  readonly narrowed: Narrowed;
}) {
  const { read, narrowed } = properties;
  return (
    <output className="mt-1 block text-muted-foreground">
      {read.data === undefined
        ? ""
        : saidOfCount(narrowed.data.length, read.data.length, narrowed.narrowing)}
    </output>
  );
}

/** The reader's own choice, else what a narrow screen has room for. */
const useHiddenColumns = () => {
  const [chosen, setChosen] = useState<ReadonlySet<string>>();
  const wide = useWideLayout();
  return [chosen ?? (wide ? NONE : NARROW_HIDES), setChosen] as const;
};

const usePageTurns = (narrowed: Narrowed) => {
  const pageCount = Math.ceil(narrowed.data.length / PAGE_SIZE);
  const turn = (pageIndex: number) => {
    if (pageIndex >= 0 && pageIndex < pageCount) narrowed.write({ page: pageIndex + 1 });
  };
  useKeystroke(KEY.previousPage, () => {
    turn(narrowed.pageIndex - 1);
  });
  useKeystroke(KEY.nextPage, () => {
    turn(narrowed.pageIndex + 1);
  });
  return turn;
};

/** A ticked person the list has since lost is still named by the act that refused them. */
const namedIn =
  (listed: readonly ListedMember[]) =>
  (personId: string): string => {
    const member = listed.find((each) => each.personId === personId);
    return member === undefined ? "A member no longer listed" : nameOf(member);
  };

function OpenedSheet(properties: {
  readonly opened: Opened | undefined;
  readonly listed: readonly ListedMember[];
  readonly onClose: () => void;
  readonly removal: ReturnType<typeof useRemovalFromTheList>;
}) {
  const { opened, removal } = properties;
  const member = properties.listed.find((each) => each.personId === opened?.personId);
  if (opened === undefined || member === undefined) return null;
  return (
    <MemberSheet
      key={opened.personId}
      member={member}
      openedAt={opened.at}
      onClose={properties.onClose}
      onRemove={removal.remove}
      returnFocus={() => {
        removal.returnFocus(opened.personId);
      }}
    />
  );
}

/** Ticks, the sheet and an act's outcome are the screen's; what narrows the rows is the address's. */
function MemberList(properties: {
  readonly read: ReturnType<typeof useMembers>;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { read, heading } = properties;
  const listed = read.data ?? NO_ONE;
  const narrowed = useNarrowedMembers(listed);
  const [ticked, setTicked] = useTicks(listed);
  const [inFocus, setInFocus] = useState<string>();
  const [opened, setOpened] = useState<Opened>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [refused, setRefused] = useState<RefusedRows>(NO_MARKS);
  const [hidden, setHidden] = useHiddenColumns();
  const searchRef = useRef<HTMLInputElement>(null);
  const turn = usePageTurns(narrowed);

  const columns = useMemo(
    () =>
      memberColumns(
        {
          open: (personId) => {
            setOpened({ personId, at: "member" });
          },
          focusedOn: setInFocus,
        },
        refused,
      ),
    [refused],
  );

  const sorted = sortedOf(narrowed.state.sort);
  const table = useTable({
    features: memberFeatures,
    columns,
    data: narrowed.data,
    getRowId: (member) => member.personId,
    state: {
      sorting: sorted === undefined ? [] : [sorted],
      pagination: { pageIndex: narrowed.pageIndex, pageSize: PAGE_SIZE },
    },
  });
  const shownIds = () => table.getRowModel().rows.map((row) => row.id);

  const acts = useMemberBulkActs({
    ticked,
    tick: setTicked,
    nameOf: namedIn(listed),
    heading,
    say: setOutcome,
    mark: setRefused,
  });

  useInFocusKeystrokes({
    inFocus: listed.find((member) => member.personId === inFocus),
    open: (personId, at) => {
      setOpened({ personId, at });
    },
    tick: (personId) => {
      setTicked(toggled(ticked, personId));
    },
    nothingInFocus: () => {
      setOutcome(NOTHING_IN_FOCUS);
    },
  });

  const removal = useRemovalFromTheList({
    shownIds,
    closeTheSheet: () => {
      setOpened(undefined);
    },
    setOutcome,
    searchRef,
  });

  return (
    <>
      <CountLine read={read} narrowed={narrowed} />
      <OutcomeLine outcome={outcome} className="mt-2" />

      <div className="mt-4 border border-border bg-card">
        <MemberFilters
          narrowed={narrowed}
          searchRef={searchRef}
          hidden={hidden}
          onHiddenChange={setHidden}
        />
        <SelectionBar
          label={SELECTED_MEMBERS}
          ticked={ticked}
          shown={shownIds()}
          noun={["member", "members"]}
          clearKeystroke={KEY.clearSelection}
          onClear={() => {
            setTicked(NONE);
          }}
          focusAfterClear={heading}
        >
          <MemberBulkActs acts={acts} />
        </SelectionBar>
        <MembersRead read={read} searchRef={searchRef}>
          <GridTable
            table={table}
            caption="Members of this workspace, each with their address, role, groups and the day they joined. A member's name opens them; a tick selects them for an act on every member selected."
            ticking={{
              ticked,
              onTickedChange: setTicked,
              nameOf,
              everyOnThePage: "Select every member on this page",
            }}
            sorting={{
              sortable: SORTABLE,
              sorted,
              onSortedChange: (next) => {
                narrowed.write({ sort: sortOf(next), page: 1 });
              },
            }}
            hidden={hidden}
            rowMenu={rowMenuOf((personId, at) => {
              setOpened({ personId, at });
            })}
            empty={<NoOneMatches narrowed={narrowed} focusAfterClear={searchRef} />}
          />
          <ListPages
            pages={{
              kind: "pages",
              label: "Pages of members",
              pageIndex: narrowed.pageIndex,
              pageSize: PAGE_SIZE,
              total: narrowed.data.length,
              onTurn: turn,
              keystrokes: { previous: KEY.previousPage.key, next: KEY.nextPage.key },
            }}
          />
        </MembersRead>
      </div>

      <MemberBulkDialogs acts={acts} />
      <OpenedSheet
        opened={opened}
        listed={listed}
        onClose={() => {
          setOpened(undefined);
        }}
        removal={removal}
      />
    </>
  );
}

/** A letter pressed outside the list still needs a member, so the one last in focus stands. */
function useInFocusKeystrokes(properties: {
  readonly inFocus: ListedMember | undefined;
  readonly open: (personId: string, at: OpenedAt) => void;
  readonly tick: (personId: string) => void;
  readonly nothingInFocus: () => void;
}) {
  const { inFocus, nothingInFocus } = properties;
  const onTheMemberInFocus = (act: (personId: string) => void) => () => {
    if (inFocus === undefined) nothingInFocus();
    else act(inFocus.personId);
  };
  const opening = (at: OpenedAt) =>
    onTheMemberInFocus((personId) => {
      properties.open(personId, at);
    });

  useKeystroke(KEY.open, opening("member"));
  useKeystroke(KEY.changeRole, opening("role"));
  useKeystroke(KEY.revokeCredentials, opening("credentials"));
  useKeystroke(KEY.changeGroups, opening("groups"));
  useKeystroke(KEY.remove, opening("removal"));
  useKeystroke(KEY.flagName, opening("flag"));
  useKeystroke(KEY.tick, onTheMemberInFocus(properties.tick));
}

export function MembersTab() {
  const members = useMembers();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Read with the list, so a sheet opened on its groups has boxes to land focus on.
  useGroups();

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        Members
      </h2>
      <MemberList read={members} heading={heading} />
    </section>
  );
}
