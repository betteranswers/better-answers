import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useId, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";

import { EmptyState } from "@/shared/empty-state.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { KeystrokesAct, useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { screenById } from "@/shared/screens.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Label } from "@/shared/ui/label.tsx";
import type { ViewToolbar } from "@/shared/view-toolbar.tsx";
import { counted } from "@/shared/words.ts";

import { EMPTY_LINES } from "./empty-lines.ts";
import { GroupSheet, groupButtonId, type GroupOpenedAt } from "./group-sheet.tsx";
import {
  inNameOrder,
  useCreateGroup,
  useDeleteGroup,
  useGroups,
  usePendingGroupNames,
  type ListedGroup,
} from "./groups-api.ts";
import { useMembers } from "./people-api.ts";
import { GROUPS_KEYSTROKES } from "./people-state.ts";
import { outcomeOfGroupFailure } from "./refusal.tsx";

const people = screenById("people");

export const GROUPS_TOOLBAR: ViewToolbar = {
  acts: <KeystrokesAct screen={people.name} keystrokes={Object.values(GROUPS_KEYSTROKES)} />,
};

/** A row is a group, or a name asked for whose group the api has not answered yet. */
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

type GroupActs = {
  readonly open: (groupId: string) => void;
  readonly focusedOn: (groupId: string) => void;
  /** The group just created: its button takes focus as it arrives. */
  readonly landOn: string | undefined;
};

const focusOnArrival = (button: HTMLButtonElement | null) => {
  button?.focus();
};

function GroupCell(properties: { readonly row: GroupRow; readonly acts: GroupActs }) {
  const { row, acts } = properties;
  if (row.group === undefined) return <span className="font-medium">{row.name}</span>;
  const groupId = row.group.id;
  return (
    <Button
      ref={groupId === acts.landOn ? focusOnArrival : undefined}
      id={groupButtonId(groupId)}
      variant="link"
      aria-haspopup="dialog"
      className="h-auto p-0 text-left font-medium whitespace-normal text-foreground"
      onFocus={() => {
        acts.focusedOn(groupId);
      }}
      onClick={() => {
        acts.open(groupId);
      }}
    >
      {row.name}
    </Button>
  );
}

/** The group's own cell opens it, so its acts ride into the columns. */
const columnsFor = (acts: GroupActs) =>
  column.columns([
    column.accessor("name", {
      header: "Group",
      cell: ({ row }) => <GroupCell row={row.original} acts={acts} />,
    }),
    column.accessor("memberCount", {
      header: "Members",
      cell: ({ getValue }) => <Pill>{counted(getValue(), "member", "members")}</Pill>,
    }),
  ]);

const CREATE_KEYSTROKE = GROUPS_KEYSTROKES.create;

function CreateGroupForm(properties: {
  readonly fieldRef: RefObject<HTMLInputElement | null>;
  readonly onAsked: () => void;
  readonly onCreated: (groupId: string, name: string) => void;
  readonly onRefused: (outcome: Outcome) => void;
}) {
  const { fieldRef, onAsked, onCreated, onRefused } = properties;
  const createGroup = useCreateGroup();
  const ids = { field: useId(), hint: useId() };

  // Never disabled: the field keeps the name and focus while the answer comes back.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const asked = new FormData(form).get("name");
    if (typeof asked !== "string") return;
    const name = asked.trim();
    onAsked();
    void createGroup.mutateAsync({ name }).then(
      ({ groupId }) => {
        form.reset();
        onCreated(groupId, name);
      },
      (failure: Error) => {
        onRefused(outcomeOfGroupFailure(failure));
      },
    );
  };

  return (
    <form
      aria-label={CREATE_KEYSTROKE.act}
      onSubmit={submit}
      className="flex flex-wrap items-end gap-2 border-b border-border p-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor={ids.field}>Name of a new group</Label>
        <Input
          ref={fieldRef}
          id={ids.field}
          name="name"
          required
          autoComplete="off"
          aria-keyshortcuts={CREATE_KEYSTROKE.key}
          aria-describedby={ids.hint}
          className="w-64"
        />
      </div>
      <Button type="submit">Create the group</Button>
      <p id={ids.hint} className="w-full text-sm text-muted-foreground">
        A binding&rsquo;s audience can name the group.
      </p>
    </form>
  );
}

const NOTHING_IN_FOCUS = selectFirst("group");

type Opened = { readonly groupId: string; readonly at: GroupOpenedAt };

function GroupList(properties: {
  readonly groups: readonly ListedGroup[];
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { groups, headingRef } = properties;
  const pending = usePendingGroupNames();
  const [inFocus, setInFocus] = useState<string>();
  const [opened, setOpened] = useState<Opened>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [landOn, setLandOn] = useState<string>();
  const fieldRef = useRef<HTMLInputElement>(null);
  // Set before the deleted row leaves the cache, so the sheet does not hand focus to it meanwhile.
  const closingOnADeletion = useRef(false);
  const deleteGroup = useDeleteGroup();
  // Read with the list, so a sheet opened on its members has boxes to land focus on.
  useMembers();

  const columns = useMemo(
    () =>
      columnsFor({
        open: (groupId) => {
          setOpened({ groupId, at: "group" });
        },
        focusedOn: setInFocus,
        landOn,
      }),
    [landOn],
  );

  const table = useTable({
    features,
    columns,
    data: useMemo(() => rowsOf(groups, pending), [groups, pending]),
    getRowId: (row) => row.key,
  });

  const groupOf = (groupId: string | undefined) => groups.find((group) => group.id === groupId);

  /** A letter pressed outside the list still needs a group, so the one last in focus stands. */
  const openInFocus = (at: GroupOpenedAt) => {
    const group = groupOf(inFocus);
    setOutcome(group === undefined ? NOTHING_IN_FOCUS : undefined);
    if (group !== undefined) setOpened({ groupId: group.id, at });
  };
  const toTheNameField = () => {
    fieldRef.current?.focus();
  };
  useKeystroke(GROUPS_KEYSTROKES.create, toTheNameField);
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

  const remove = (group: ListedGroup) => {
    closingOnADeletion.current = true;
    setOpened(undefined);
    setOutcome(undefined);
    void deleteGroup.mutateAsync({ groupId: group.id }).then(
      () => {
        setOutcome({ tone: "said", words: `${group.name} is deleted.` });
      },
      (failure: Error) => {
        setOutcome(outcomeOfGroupFailure(failure));
      },
    );
  };

  const openedGroup = groupOf(opened?.groupId);

  return (
    <>
      <output className="mt-1 block text-muted-foreground">
        {counted(groups.length, "group", "groups")}
      </output>
      <OutcomeLine outcome={outcome} className="mt-2" />

      <div className="mt-4 border border-border bg-card">
        <CreateGroupForm
          fieldRef={fieldRef}
          onAsked={() => {
            setOutcome(undefined);
          }}
          onCreated={(groupId, name) => {
            setOutcome({ tone: "said", words: `${name} is created.` });
            setLandOn(groupId);
          }}
          onRefused={setOutcome}
        />
        <GridTable
          table={table}
          caption="Groups in this workspace, each with how many members it holds. A group's name opens it."
          empty={<EmptyState line={EMPTY_LINES.groups} className="px-4 py-10" />}
        />
      </div>

      {opened === undefined || openedGroup === undefined ? null : (
        <GroupSheet
          key={opened.groupId}
          group={openedGroup}
          openedAt={opened.at}
          onClose={() => {
            setOpened(undefined);
          }}
          returnFocus={() => {
            const row = closingOnADeletion.current
              ? null
              : document.getElementById(groupButtonId(openedGroup.id));
            closingOnADeletion.current = false;
            // A group another Admin deleted meanwhile has no row either.
            (row ?? headingRef.current)?.focus();
          }}
          onDelete={remove}
        />
      )}
    </>
  );
}

function GroupsSection() {
  const groups = useGroups();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        Groups
      </h2>
      <OutcomeLine
        outcome={groups.error === null ? undefined : outcomeOfGroupFailure(groups.error, "read")}
        className="mt-2"
      />
      <div aria-live="polite">
        {groups.isPending ? <p className="mt-2">The groups are still loading.</p> : null}
      </div>
      {groups.data === undefined ? null : (
        <GroupList groups={groups.data} headingRef={headingRef} />
      )}
    </section>
  );
}

export function GroupsView() {
  return (
    <>
      <h1>{people.name}</h1>
      <p className="mt-2 text-muted-foreground">{people.summary}</p>
      <GroupsSection />
    </>
  );
}
