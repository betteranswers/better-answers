import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { ListPages, ListState } from "@/shared/list-pages.tsx";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { RowMenu } from "@/shared/row-menu.tsx";
import { useSearchedList } from "@/shared/searched-list.ts";
import { SelectionBar } from "@/shared/selection-bar.tsx";
import { useHiddenColumns } from "@/shared/wide-layout.ts";

import { useGroups } from "./groups-api.ts";
import {
  MEMBER_PAGE_WORDS,
  MEMBERS_LOADING,
  NO_LONGER_LISTED,
  SELECTED_MEMBERS,
} from "./member-action-words.ts";
import {
  MemberBulkActions,
  MemberBulkDialogs,
  useMemberBulkActions,
} from "./member-bulk-actions.tsx";
import {
  HIDEABLE,
  MemberActionsContext,
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

/** Person and role are what a narrow window has room for; the rest can be shown again. */
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

/** A clear empties the search and filters and keeps the reader's sort. */
const KEPT_ON_CLEAR = ["sort"] as const;

const useNarrowedMembers = (listed: readonly ListedMember[]) => {
  const list = useSearchedList(MEMBERS_LIST, MEMBERS_FIELDS, KEPT_ON_CLEAR);
  const { search } = list;
  const { role, group } = list.state;
  const narrowing: Narrowing = { search, role, group };
  const data = useMemo(
    () => listed.filter(matching({ search, role, group })),
    [listed, search, role, group],
  );
  return { ...list, narrowing, data, pageIndex: list.pageIndex(PAGE_SIZE, data.length) };
};

type Narrowed = ReturnType<typeof useNarrowedMembers>;

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

/** Each of the row's actions opens the member's page at that action's control. */
const ROW_ACTIONS: readonly { readonly label: string; readonly at: OpenedAt }[] = [
  { label: "Open", at: "member" },
  { label: "Change role", at: "role" },
  { label: "Add to group", at: "groups" },
  { label: "Remove", at: "removal" },
];

const rowMenuOf = (open: (personId: string, at: OpenedAt) => void) => (member: ListedMember) => (
  <RowMenu
    name={nameOf(member)}
    actions={ROW_ACTIONS.map(({ label, at }) => ({
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

/** A ticked person the list has since lost is still named by the action that refused them. */
const namedIn =
  (listed: readonly ListedMember[]) =>
  (personId: string): string => {
    const member = listed.find((each) => each.personId === personId);
    return member === undefined ? NO_LONGER_LISTED : nameOf(member);
  };

/** Ticks and an action's outcome are the page's; what narrows the rows is the address's. */
function MemberList(properties: {
  readonly read: ReturnType<typeof useMembers>;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { read, heading } = properties;
  const listed = read.data ?? NO_ONE;
  const narrowed = useNarrowedMembers(listed);
  // A tick outlives its row, so the next action refuses or skips that person and says so.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(NONE);
  const [inFocus, setInFocus] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [refused, setRefused] = useState<RefusedRows>(NO_MARKS);
  const [hidden, setHidden] = useHiddenColumns(NARROW_HIDES);
  const searchRef = useRef<HTMLInputElement>(null);
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

  const actions = useMemberBulkActions({
    readable: read.isSuccess,
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
        <MembersRead read={read} searchRef={searchRef}>
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
            <MemberBulkActions actions={actions} />
          </SelectionBar>
          <MemberActionsContext
            value={{
              open: (personId) => {
                openMember(personId, "member");
              },
              focusedOn: setInFocus,
            }}
          >
            <GridTable
              table={table}
              caption="Members of this workspace, each with their address, role, groups and the day they joined. A member's name opens them; a tick selects them for an action on every member selected."
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
          </MemberActionsContext>
          <ListPages
            pages={{
              kind: "pages",
              label: "Pages of members",
              pageIndex: narrowed.pageIndex,
              pageSize: PAGE_SIZE,
              total: narrowed.data.length,
              onTurn: (pageIndex) => {
                narrowed.write({ page: pageIndex + 1 });
              },
              keystrokes: { previous: KEY.previousPage, next: KEY.nextPage },
            }}
          />
        </MembersRead>
      </div>

      <MemberBulkDialogs actions={actions} />
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
  const onTheMemberInFocus = (action: (personId: string) => void) => () => {
    if (inFocus === undefined) nothingInFocus();
    else action(inFocus.personId);
  };
  const opening = (at: OpenedAt) =>
    onTheMemberInFocus((personId) => {
      properties.open(personId, at);
    });

  useKeystroke(KEY.open, opening("member"));
  useKeystroke(KEY.changeRole, opening("role"));
  useKeystroke(KEY.endEverySignInAndToken, opening("credentials"));
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
