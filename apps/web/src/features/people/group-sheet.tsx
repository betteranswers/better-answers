import { useId, useRef, useState, type FormEvent, type RefObject } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { RowSheet } from "@/shared/row-sheet.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet.tsx";
import { counted } from "@/shared/words.ts";

import { GroupChecklist } from "./group-checklist.tsx";
import { useRenameGroup, type ListedGroup } from "./groups-api.ts";
import { useMembers } from "./people-api.ts";
import { outcomeOfFailure, outcomeOfGroupFailure } from "./refusal.tsx";
import { nameOf, RECORDED } from "./words.tsx";

/** Where focus lands when the sheet opens: on the group, or straight on one of its acts. */
export type GroupOpenedAt = "group" | "members" | "rename" | "delete";

export const groupButtonId = (groupId: string): string => `group-${groupId}`;

const membersWord = (group: ListedGroup): string => counted(group.memberCount, "member", "members");

function GroupMembers(properties: {
  readonly group: ListedGroup;
  readonly listRef: RefObject<HTMLFieldSetElement | null>;
}) {
  const { group, listRef } = properties;
  const members = useMembers();
  const everyone = members.data ?? [];

  return (
    <SheetPart title="Members">
      <OutcomeLine outcome={members.error === null ? undefined : outcomeOfFailure(members.error)} />
      <div aria-live="polite" className="empty:hidden">
        {members.isPending ? <p>The members are still loading.</p> : null}
      </div>
      {members.data === undefined ? null : (
        <GroupChecklist
          legend={`Members of ${group.name}`}
          hint={`Each box puts the member in ${group.name} or takes them out at once. ${RECORDED}`}
          listRef={listRef}
          choices={everyone.map((member) => ({
            id: member.personId,
            label: nameOf(member),
            detail: member.displayName === "" ? undefined : member.address,
            checked: member.groups.some((held) => held.groupId === group.id),
          }))}
          pairOf={(personId) => {
            const member = everyone.find((candidate) => candidate.personId === personId);
            return member === undefined
              ? undefined
              : {
                  inGroup: { groupId: group.id, userId: personId },
                  person: nameOf(member),
                  group: group.name,
                };
          }}
        />
      )}
    </SheetPart>
  );
}

function RenameGroup(properties: {
  readonly group: ListedGroup;
  readonly fieldRef: RefObject<HTMLInputElement | null>;
}) {
  const { group, fieldRef } = properties;
  const [outcome, setOutcome] = useState<Outcome>();
  const renameGroup = useRenameGroup();
  const ids = { field: useId(), hint: useId() };

  // Never disabled: the button a reader pressed keeps focus while the answer comes back.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const asked = new FormData(event.currentTarget).get("name");
    if (typeof asked !== "string") return;
    const was = group.name;
    const name = asked.trim();
    if (name === was) {
      setOutcome({ tone: "said", words: `${was} is its name already.` });
      return;
    }
    setOutcome(undefined);
    void renameGroup.mutateAsync({ groupId: group.id, name }).then(
      () => {
        setOutcome({ tone: "said", words: `${was} is ${name} now.` });
      },
      (failure: Error) => {
        setOutcome(outcomeOfGroupFailure(failure));
      },
    );
  };

  return (
    <SheetPart title="Rename">
      <OutcomeLine outcome={outcome} />
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor={ids.field}>Name</Label>
          <Input
            ref={fieldRef}
            id={ids.field}
            name="name"
            defaultValue={group.name}
            required
            autoComplete="off"
            aria-describedby={ids.hint}
          />
          <p id={ids.hint} className="text-sm text-muted-foreground">
            Its members stay in it. {RECORDED}
          </p>
        </div>
        <Button type="submit" className="justify-self-start">
          Rename {group.name}
        </Button>
      </form>
    </SheetPart>
  );
}

function DeleteGroup(properties: {
  readonly group: ListedGroup;
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
  readonly onDelete: (group: ListedGroup) => void;
}) {
  const { group, buttonRef, onDelete } = properties;
  const consequence =
    group.memberCount === 0
      ? `Deleting ${group.name} cannot be undone.`
      : `Deleting ${group.name} takes its ${membersWord(group)} out of it, and cannot be undone.`;

  return (
    <SheetPart title="Delete">
      <p className="text-sm">{consequence}</p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button ref={buttonRef} variant="outline" className="justify-self-start">
            Delete {group.name}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {group.name}</AlertDialogTitle>
            <AlertDialogDescription>
              {consequence} {RECORDED}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep {group.name}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onDelete(group);
              }}
            >
              Delete {group.name}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SheetPart>
  );
}

export function GroupSheet(properties: {
  readonly group: ListedGroup;
  readonly openedAt: GroupOpenedAt;
  readonly onClose: () => void;

  /** Deleting the group takes its row away, so the list decides where focus lands. */
  readonly returnFocus: () => void;
  readonly onDelete: (group: ListedGroup) => void;
}) {
  const { group, openedAt, onClose, returnFocus, onDelete } = properties;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLFieldSetElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  const landOn = {
    group: () => titleRef.current,
    members: () => listRef.current?.querySelector<HTMLElement>('[role="checkbox"]'),
    rename: () => fieldRef.current,
    delete: () => deleteRef.current,
  } satisfies Readonly<Record<GroupOpenedAt, () => HTMLElement | null | undefined>>;

  return (
    <RowSheet
      rowButtonId={groupButtonId(group.id)}
      onOpen={() => {
        (landOn[openedAt]() ?? titleRef.current)?.focus();
      }}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <SheetHeader className="border-b border-border">
        <SheetTitle asChild>
          <h2 ref={titleRef} tabIndex={-1} className="pr-8 wrap-anywhere">
            {group.name}
          </h2>
        </SheetTitle>
        <SheetDescription>{membersWord(group)}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        <GroupMembers group={group} listRef={listRef} />
        <RenameGroup group={group} fieldRef={fieldRef} />
        <DeleteGroup group={group} buttonRef={deleteRef} onDelete={onDelete} />
      </div>
    </RowSheet>
  );
}
