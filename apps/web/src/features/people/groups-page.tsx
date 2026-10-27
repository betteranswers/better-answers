import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { createContext, useContext, useId, useMemo, useRef, useState } from "react";

import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { ListRead, ListState, NothingListed } from "@/shared/list-pages.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { rowInFocus } from "@/shared/row-focus.ts";
import { RowMenu } from "@/shared/row-menu.tsx";
import { RowSheetButton } from "@/shared/row-sheet.tsx";
import { useSearchedList } from "@/shared/searched-list.ts";
import { Card } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { counted, nothingMatches } from "@/shared/words.ts";

import { CreateGroupAction } from "./create-group-action.tsx";
import { DeleteGroupDialog } from "./delete-group-dialog.tsx";
import { EMPTY_LINES } from "./empty-lines.ts";
import { GroupSheet, groupButtonId, groupMenuId, type GroupOpenedAt } from "./group-sheet.tsx";
import { GROUP_WORDS } from "./group-words.ts";
import { GROUPS_FIELDS, GROUPS_LIST } from "./groups-address.ts";
import { useDeleteGroup, useGroups, usePendingGroupNames, type ListedGroup } from "./groups-api.ts";
import { GROUPS_LOADING } from "./member-action-words.ts";
import { inNameOrder, useMembers } from "./people-api.ts";
import { GROUPS_KEYSTROKES, PEOPLE_SELECT_FIRST } from "./people-state.ts";
import { outcomeOfGroupFailure } from "./refusal.tsx";
import { RenameGroupDialog } from "./rename-group-dialog.tsx";

const people = menuGroupIn(CONTROL_CENTRE, "people");

const LISTED = Object.values(GROUPS_KEYSTROKES);

const GROUPS_HEADING = "Groups";

const SEARCH_LABEL = "Search by name";

const NOTHING_IN_FOCUS = selectFirst(PEOPLE_SELECT_FIRST.group);

type GroupRow = {
  readonly key: string;
  readonly name: string;
  readonly memberCount: number;
  readonly group: ListedGroup | undefined;
};

const rowsOf = (
  groups: readonly ListedGroup[],
  pending: readonly (string | undefined)[],
): GroupRow[] =>
  inNameOrder([
    ...groups.map((group) => ({
      key: group.id,
      name: group.name,
      memberCount: group.memberCount,
      group,
    })),
    ...pending.flatMap((name) =>
      name === undefined ? [] : [{ key: `asked ${name}`, name, memberCount: 0, group: undefined }],
    ),
  ]);

const features = tableFeatures({});

const column = createColumnHelper<typeof features, GroupRow>();

type GroupActions = {
  readonly open: (groupId: string) => void;
  readonly landOn: string | undefined;
  readonly landed: (button: HTMLButtonElement | null) => void;
};

const GroupActionsContext = createContext<GroupActions | undefined>(undefined);

function GroupCell(properties: { readonly row: GroupRow }) {
  const { row } = properties;
  const actions = useContext(GroupActionsContext);
  if (row.group === undefined || actions === undefined) {
    return <span className="font-medium">{row.name}</span>;
  }
  const groupId = row.group.id;
  return (
    <RowSheetButton
      ref={groupId === actions.landOn ? actions.landed : undefined}
      id={groupButtonId(groupId)}
      onClick={() => {
        actions.open(groupId);
      }}
    >
      {row.name}
    </RowSheetButton>
  );
}

const COLUMNS = column.columns([
  column.accessor("name", {
    header: "Group",
    cell: ({ row }) => <GroupCell row={row.original} />,
  }),
  column.accessor("memberCount", {
    header: "Members",
    cell: ({ getValue }) => <Pill>{counted(getValue(), "member", "members")}</Pill>,
  }),
]);

const matching = (search: string) => {
  const sought = search.toLowerCase();
  return (row: GroupRow): boolean => row.name.toLowerCase().includes(sought);
};

const useNarrowedGroups = (rows: readonly GroupRow[]) => {
  const list = useSearchedList(GROUPS_LIST, GROUPS_FIELDS);
  const data = useMemo(() => rows.filter(matching(list.search)), [rows, list.search]);
  return { ...list, data };
};

const saidOfCount = (shown: number, total: number, search: string): string =>
  search === ""
    ? counted(total, "group", "groups")
    : `${String(shown)} of ${counted(total, "group", "groups")} match “${search}”.`;

type Opened = { readonly groupId: string; readonly at: GroupOpenedAt };

function MembersRead() {
  useMembers();
  return null;
}

function GroupsList(properties: { readonly headingId: string }) {
  const read = useGroups();
  const pending = usePendingGroupNames();
  const heading = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<Opened>();
  const [renaming, setRenaming] = useState<ListedGroup>();
  const [deleting, setDeleting] = useState<ListedGroup>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [landOn, setLandOn] = useState<string>();
  const deleteGroup = useDeleteGroup();
  const closingOnADeletion = useRef(false);

  const rows = useMemo(() => rowsOf(read.data ?? [], pending), [read.data, pending]);
  const narrowed = useNarrowedGroups(rows);
  const { search, data } = narrowed;

  const actions = useMemo<GroupActions>(
    () => ({
      open: (groupId) => {
        setOpened({ groupId, at: "group" });
      },
      landOn,
      landed: (button) => {
        if (button === null) return;
        button.focus();
        setLandOn(undefined);
      },
    }),
    [landOn],
  );

  const table = useTable({
    features,
    columns: COLUMNS,
    data,
    getRowId: (row) => row.key,
  });

  const groupOf = (groupId: string | undefined) =>
    (read.data ?? []).find((group) => group.id === groupId);

  const landOnOrHeading = (elementId: string | undefined) => {
    const target = elementId === undefined ? null : document.getElementById(elementId);
    (target ?? heading.current)?.focus();
  };

  const openInFocus = (at: GroupOpenedAt) => {
    const group = rowInFocus(read.data ?? [], (each) => each.id);
    setOutcome(group === undefined ? NOTHING_IN_FOCUS : undefined);
    if (group !== undefined) setOpened({ groupId: group.id, at });
  };
  useKeystroke(GROUPS_KEYSTROKES.open, () => {
    openInFocus("group");
  });
  useKeystroke(GROUPS_KEYSTROKES.changeMembers, () => {
    openInFocus("members");
  });
  useKeystroke(GROUPS_KEYSTROKES.rename, () => {
    openInFocus("rename");
  });
  useKeystroke(GROUPS_KEYSTROKES.delete, () => {
    openInFocus("delete");
  });

  const rowMenuOf = (row: GroupRow) =>
    row.group === undefined ? null : (
      <RowMenu
        name={row.name}
        triggerId={groupMenuId(row.group.id)}
        actions={[
          {
            label: "Rename",
            onSelect: () => {
              setRenaming(row.group);
            },
          },
          {
            label: "Delete",
            destructive: true,
            onSelect: () => {
              closingOnADeletion.current = false;
              setDeleting(row.group);
            },
          },
        ]}
      />
    );

  const remove = (group: ListedGroup) => {
    closingOnADeletion.current = true;
    setOpened(undefined);
    setOutcome(undefined);
    void deleteGroup.mutateAsync({ groupId: group.id }).then(
      () => {
        setOutcome({ tone: "said", words: GROUP_WORDS.deleted(group.name) });
      },
      (failure: Error) => {
        setOutcome(outcomeOfGroupFailure(failure, "action"));
      },
    );
  };

  const openedGroup = groupOf(opened?.groupId);

  return (
    <>
      <ListHead
        heading={GROUPS_HEADING}
        headingId={properties.headingId}
        headingRef={heading}
        count={read.data === undefined ? "" : saidOfCount(data.length, read.data.length, search)}
        action={
          <CreateGroupAction
            onCreated={(groupId, name) => {
              setOutcome({ tone: "said", words: GROUP_WORDS.created(name) });
              setLandOn(groupId);
            }}
          />
        }
      />
      <OutcomeLine outcome={outcome} className="mt-2" />

      <Card className="mt-4">
        <FilterRow
          search={{
            label: SEARCH_LABEL,
            value: search,
            onChange: narrowed.setSearch,
            keystroke: GROUPS_KEYSTROKES.search,
            inputRef: searchRef,
          }}
        />
        <ListRead
          read={read}
          loading={GROUPS_LOADING}
          failed={(failure) => outcomeOfGroupFailure(failure, "read").words}
          focusAfterRetry={searchRef}
        >
          <MembersRead />
          <GroupActionsContext value={actions}>
            <GridTable
              table={table}
              caption="Groups in this workspace."
              rowMenu={rowMenuOf}
              empty={
                <NothingListed
                  search={search}
                  noneMatch={nothingMatches}
                  onClear={narrowed.clear}
                  searchRef={searchRef}
                >
                  <ListState
                    state={{ kind: "empty", words: EMPTY_LINES.groups, action: undefined }}
                  />
                </NothingListed>
              }
            />
          </GroupActionsContext>
        </ListRead>
      </Card>

      {opened === undefined || openedGroup === undefined ? null : (
        <GroupSheet
          key={opened.groupId}
          group={openedGroup}
          openedAt={opened.at}
          onClose={() => {
            setOpened(undefined);
          }}
          returnFocus={() => {
            const row = closingOnADeletion.current ? undefined : groupButtonId(openedGroup.id);
            closingOnADeletion.current = false;
            landOnOrHeading(row);
          }}
          onDelete={remove}
        />
      )}
      {renaming === undefined ? null : (
        <RenameGroupDialog
          key={renaming.id}
          group={renaming}
          onRenamed={setOutcome}
          onClose={() => {
            setRenaming(undefined);
          }}
          onFocusBack={() => {
            landOnOrHeading(groupMenuId(renaming.id));
          }}
        />
      )}
      {deleting === undefined ? null : (
        <DeleteGroupDialog
          key={deleting.id}
          group={deleting}
          onDelete={remove}
          onClose={() => {
            setDeleting(undefined);
          }}
          onFocusBack={() => {
            const trigger = closingOnADeletion.current ? undefined : groupMenuId(deleting.id);
            closingOnADeletion.current = false;
            landOnOrHeading(trigger);
          }}
        />
      )}
    </>
  );
}

export function GroupsPage() {
  usePageKeystrokes(LISTED);
  const headingId = useId();

  return (
    <>
      <PageHead heading={people.name} summary={people.summary} />
      <section aria-labelledby={headingId} className="mt-6">
        <GroupsList headingId={headingId} />
      </section>
    </>
  );
}
