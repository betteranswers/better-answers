import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

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
import {
  MEMBER_PAGE_WORDS,
  MEMBERS_LOADING,
  NO_LONGER_LISTED,
  SELECTED_MEMBERS,
} from "./member-act-words.ts";
import { MemberBulkActs, MemberBulkDialogs, useMemberBulkActs } from "./member-bulk-acts.tsx";
import {
  HIDEABLE,
  MemberActsContext,
  memberColumns,
  memberFeatures,
  NO_MARKS,
  SORTABLE,
  type RefusedRows,
} from "./member-columns.tsx";
import {
  MEMBERS_FIELDS,
  MEMBERS_LIST,
  memberPageOf,
  RETURNED_FROM_A_REMOVAL,
  sortedOf,
  sortOf,
  useSettledSearch,
  type OpenedAt,
  type Opening,
} from "./members-address.ts";
import { useMembers, useRemovalOf, type ListedMember, type Role } from "./people-api.ts";
import { PEOPLE_KEYSTROKES as KEY } from "./people-state.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { ROLES } from "./role-meanings.ts";
import { nameOf } from "./words.tsx";

/** The members read returns the whole workspace, so the browser pages it. */
const PAGE_SIZE = 25;

const SEARCH_LABEL = "Search by name or address";

const NOTHING_IN_FOCUS = selectFirst("member");

const NONE: ReadonlySet<string> = new Set();

const NO_ONE: readonly ListedMember[] = [];

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

const matching = (narrowing: Narrowing) => {
  const search = narrowing.search.toLowerCase();
  return (member: ListedMember): boolean =>
    (narrowing.role === undefined || member.role === narrowing.role) &&
    (narrowing.group === undefined ||
      member.groups.some((group) => group.groupId === narrowing.group)) &&
    `${member.displayName} ${member.address}`.toLowerCase().includes(search);
};

/** Read in render from the address, so Back and a reload come to the same rows. */
const useNarrowedMembers = (listed: readonly ListedMember[]) => {
  const { state, write } = useListAddress(MEMBERS_LIST, MEMBERS_FIELDS);
  const [search, setSearch, flush] = useSettledSearch(state.search, (settled) => {
    write({ search: settled, page: 1 });
  });
  const { role, group } = state;
  const narrowing: Narrowing = { search, role, group };
  const data = useMemo(
    () => listed.filter(matching({ search, role, group })),
    [listed, search, role, group],
  );
  // A search still settling has not reached the address, so it shows its first page.
  const asked = search === state.search ? state.page - 1 : 0;
  const pageIndex = pageWithin(asked, PAGE_SIZE, data.length);

  const clear = () => {
    setSearch("");
    write({ search: "", role: undefined, group: undefined, page: 1 });
  };

  return { state, write, search, setSearch, flush, narrowing, data, pageIndex, clear };
};

type Narrowed = ReturnType<typeof useNarrowedMembers>;

const stillListed = (
  held: ReadonlySet<string>,
  listed: readonly ListedMember[],
): ReadonlySet<string> => {
  if (held.size === 0) return held;
  const listedIds: ReadonlySet<string> = new Set(listed.map((member) => member.personId));
  const kept = [...held].filter((id) => listedIds.has(id));
  return kept.length === held.size ? held : new Set(kept);
};

/** A person gone from the list can be acted on no more, so their tick goes with them. */
const useTicks = (listed: readonly ListedMember[]) => {
  const [held, setHeld] = useState<ReadonlySet<string>>(NONE);
  return [stillListed(held, listed), setHeld] as const;
};

const toggled = (ticked: ReadonlySet<string>, personId: string): ReadonlySet<string> => {
  const next = new Set(ticked);
  if (next.has(personId)) next.delete(personId);
  else next.add(personId);
  return next;
};

/**
 * Pushed, so Back comes to these rows again; a search still settling is sent first, or Back would
 * lose its last keys.
 */
const useOpenMember = (flush: () => void) => {
  const navigate = useNavigate();
  const router = useRouter();

  return (personId: string, openedAt: OpenedAt) => {
    flush();
    // The browser's history folds a replace and a push in one task into one push, losing the search.
    router.history.flush();
    const opening: Opening = { openedAt, membersQuery: router.latestLocation.searchStr };
    void navigate({ href: memberPageOf(personId), state: (held) => ({ ...held, ...opening }) });
  };
};

/** A removal asked on a member's own page lands here before the api answers it. */
const removalSaid = (
  name: string | undefined,
  removal: ReturnType<typeof useRemovalOf>,
): Outcome | undefined => {
  if (name === undefined || removal === undefined) return undefined;
  if (removal.error !== null) return outcomeOfFailure(removal.error);
  return {
    tone: "said",
    words:
      removal.status === "success"
        ? MEMBER_PAGE_WORDS.removed(name)
        : MEMBER_PAGE_WORDS.removing(name),
  };
};

/** Arriving from a removal: the list it changed takes focus, and says how the removal went. */
const useReturnedFromARemoval = (heading: RefObject<HTMLElement | null>): Outcome | undefined => {
  const personId = useRouterState({
    select: (state) =>
      RETURNED_FROM_A_REMOVAL.safeParse(state.location.state).data?.removed.personId,
  });
  const name = useRouterState({
    select: (state) => RETURNED_FROM_A_REMOVAL.safeParse(state.location.state).data?.removed.name,
  });
  const removal = useRemovalOf(personId);

  useEffect(() => {
    if (personId !== undefined) heading.current?.focus();
  }, [personId, heading]);

  return removalSaid(name, removal);
};

/** Each of the row's acts opens the member's page at that act's control. */
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
    return <ListState state={{ kind: "loading", words: MEMBERS_LOADING }} />;
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
    return member === undefined ? NO_LONGER_LISTED : nameOf(member);
  };

/** Ticks and an act's outcome are the screen's; what narrows the rows is the address's. */
function MemberList(properties: {
  readonly read: ReturnType<typeof useMembers>;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { read, heading } = properties;
  const listed = read.data ?? NO_ONE;
  const narrowed = useNarrowedMembers(listed);
  const [ticked, setTicked] = useTicks(listed);
  const [inFocus, setInFocus] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [refused, setRefused] = useState<RefusedRows>(NO_MARKS);
  const [hidden, setHidden] = useHiddenColumns();
  const searchRef = useRef<HTMLInputElement>(null);
  const turn = usePageTurns(narrowed);
  const openMember = useOpenMember(narrowed.flush);
  const returned = useReturnedFromARemoval(heading);

  const columns = useMemo(() => memberColumns(refused), [refused]);

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
    open: openMember,
    tick: (personId) => {
      setTicked(toggled(ticked, personId));
    },
    nothingInFocus: () => {
      setOutcome(NOTHING_IN_FOCUS);
    },
  });

  return (
    <>
      <CountLine read={read} narrowed={narrowed} />
      <OutcomeLine outcome={outcome ?? returned} className="mt-2" />

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
          <MemberActsContext
            value={{
              open: (personId) => {
                openMember(personId, "member");
              },
              focusedOn: setInFocus,
            }}
          >
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
              rowMenu={rowMenuOf(openMember)}
              empty={<NoOneMatches narrowed={narrowed} focusAfterClear={searchRef} />}
            />
          </MemberActsContext>
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
  // Read with the list, so a member's page opened on its groups has boxes to land focus on.
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
