import { Link } from "@tanstack/react-router";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { ActDialog } from "@/shared/act-dialog.tsx";
import type { ApiError } from "@/shared/api/trpc.ts";
import { EmptyState } from "@/shared/empty-state.tsx";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { CONTROL_CENTRE, groupIn, screenNamed } from "@/shared/navigation.ts";
import { selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { failureOutcome, RefusedItemLines, saidOfItems } from "@/shared/refusal-outcome.tsx";
import { SelectionAct } from "@/shared/selection-bar.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Label } from "@/shared/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select.tsx";

import { EMPTY_LINES } from "./empty-lines.ts";
import { useGroups } from "./groups-api.ts";
import { BULK_WORDS } from "./member-act-words.ts";
import type { RefusedRows } from "./member-columns.tsx";
import {
  useBulkAddToGroup,
  useBulkChangeRole,
  useBulkRemove,
  useReaderId,
  type BulkChanged,
  type Role,
} from "./people-api.ts";
import { PEOPLE_KEYSTROKES as KEY } from "./people-state.ts";
import { SAID_OF_TICKED_MEMBERS } from "./refusal-words.ts";
import { ROLE_OFFERED_FIRST, RoleChoice } from "./role-choice.tsx";
import { useIncludesYou, useSelfActHome } from "./self-act.tsx";

const GROUPS_SCREEN = screenNamed(groupIn(CONTROL_CENTRE, "people"), "Groups").path;

type BulkAct = "role" | "group" | "remove";

type Settled = {
  readonly onSuccess: (answer: BulkChanged) => void;
  readonly onError: (failure: Error | ApiError) => void;
};

/** What the list hands its bulk acts: the ticks, and where an act's outcome and marks land. */
export type BulkList = {
  readonly ticked: ReadonlySet<string>;
  readonly tick: (ticked: ReadonlySet<string>) => void;
  readonly nameOf: (personId: string) => string;
  readonly heading: RefObject<HTMLElement | null>;
  readonly say: (outcome: Outcome | undefined) => void;
  readonly mark: (refused: RefusedRows) => void;
};

const NOTHING_TICKED = selectFirst("member");

const NO_MARKS: RefusedRows = new Map();

const NO_GROUPS: readonly { readonly id: string; readonly name: string }[] = [];

const refusedRowsOf = (failure: Error | ApiError): RefusedRows =>
  new Map(saidOfItems(SAID_OF_TICKED_MEMBERS, failure).map(({ id, said }) => [id, said]));

/** Names are taken at the press, so a person the list has since lost is still named. */
const refusalOf = (failure: Error | ApiError, names: ReadonlyMap<string, string>): Outcome => {
  const count = saidOfItems(SAID_OF_TICKED_MEMBERS, failure).length;
  if (count === 0) return failureOutcome(SAID_OF_TICKED_MEMBERS, failure);
  return {
    tone: "refused",
    words: (
      <>
        <p>{BULK_WORDS.refused(count)}</p>
        <div className="mt-1">
          <RefusedItemLines
            featureWords={SAID_OF_TICKED_MEMBERS}
            failure={failure}
            nameOf={(personId) => names.get(personId) ?? "A member no longer listed"}
          />
        </div>
      </>
    ),
  };
};

/** Shifted, so a selection's act never shares a key with the act on the member in focus. */
const shortcutOf = (keystroke: Keystroke): string => `Shift+${keystroke.key}`;

export const useMemberBulkActs = (list: BulkList) => {
  const [open, setOpen] = useState<BulkAct>();
  const [asked, setAsked] = useState<readonly string[]>([]);
  const [role, setRole] = useState<Role>(ROLE_OFFERED_FIRST);
  const [groupId, setGroupId] = useState<string>();
  const opener = useRef<HTMLElement>(null);
  const sent = useRef(false);
  const readerId = useReaderId();
  const { goHome } = useSelfActHome();

  const show = (act: BulkAct) => {
    if (list.ticked.size === 0) {
      list.say(NOTHING_TICKED);
      return;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sent.current = false;
    setAsked([...list.ticked]);
    setRole(ROLE_OFFERED_FIRST);
    setGroupId(undefined);
    setOpen(act);
  };

  /** A sent act spends the ticks that showed its button, so focus goes to the list it changed. */
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (!sent.current) opener.current?.focus();
    if (document.activeElement !== opener.current || sent.current) list.heading.current?.focus();
  };

  /** Spent at the press, so the act reads as taken within a tenth of a second. */
  const command = (said: {
    readonly pending: string;
    readonly done: (answer: BulkChanged) => string;
    readonly landing: "demoted" | "removed" | undefined;
    readonly run: (personIds: string[], settled: Settled) => void;
  }) => {
    const names = new Map(asked.map((personId) => [personId, list.nameOf(personId)]));
    const yourOwn = readerId !== undefined && asked.includes(readerId) ? said.landing : undefined;
    sent.current = true;
    setOpen(undefined);
    list.tick(new Set());
    list.mark(NO_MARKS);
    list.say({ tone: "said", words: said.pending });
    said.run([...asked], {
      onSuccess: (answer) => {
        list.say({ tone: "said", words: said.done(answer) });
        if (yourOwn === undefined) return;
        void goHome(yourOwn).then((unread) => {
          if (unread !== undefined) list.say(unread);
        });
      },
      onError: (failure) => {
        list.tick(new Set(asked));
        list.mark(refusedRowsOf(failure));
        list.say(refusalOf(failure, names));
      },
    });
  };

  useKeystroke(KEY.changeSelectedRoles, () => {
    show("role");
  });
  useKeystroke(KEY.addSelectedToGroup, () => {
    show("group");
  });
  useKeystroke(KEY.removeSelected, () => {
    show("remove");
  });

  return { open, setOpen, asked, role, setRole, groupId, setGroupId, show, returnFocus, command };
};

type Acts = ReturnType<typeof useMemberBulkActs>;

/** The bar's acts; each opens one dialog holding its value and its confirmation. */
export function MemberBulkActs(properties: { readonly acts: Acts }) {
  const { acts } = properties;
  return (
    <>
      <SelectionAct
        aria-keyshortcuts={shortcutOf(KEY.changeSelectedRoles)}
        onClick={() => {
          acts.show("role");
        }}
      >
        {BULK_WORDS.changeRole.act}
      </SelectionAct>
      <SelectionAct
        aria-keyshortcuts={shortcutOf(KEY.addSelectedToGroup)}
        onClick={() => {
          acts.show("group");
        }}
      >
        {BULK_WORDS.addToGroup.act}
      </SelectionAct>
      <SelectionAct
        aria-keyshortcuts={shortcutOf(KEY.removeSelected)}
        onClick={() => {
          acts.show("remove");
        }}
      >
        {BULK_WORDS.remove.act}
      </SelectionAct>
    </>
  );
}

function BulkDialog(properties: {
  readonly acts: Acts;
  readonly act: BulkAct;
  readonly title: string;
  readonly consequence: string;
  readonly commit: ReactNode;
  readonly children?: ReactNode;
}) {
  const { acts } = properties;
  const includesYou = useIncludesYou(acts.asked);
  return (
    <ActDialog
      open={acts.open === properties.act}
      onOpenChange={(open) => {
        if (!open) acts.setOpen(undefined);
      }}
      content={{ className: "wrap-anywhere", onCloseAutoFocus: acts.returnFocus }}
      title={properties.title}
      consequence={properties.consequence}
      commit={properties.commit}
    >
      {includesYou === undefined ? null : <p className="font-medium">{includesYou}</p>}
      {properties.children}
    </ActDialog>
  );
}

function ChangeRoleDialog(properties: { readonly acts: Acts }) {
  const { acts } = properties;
  const change = useBulkChangeRole();
  const count = acts.asked.length;
  const { role } = acts;

  const commit = () => {
    acts.command({
      pending: BULK_WORDS.changeRole.pending(count, role),
      done: (answer) => BULK_WORDS.changeRole.done(answer.changed.length, role, answer.skipped),
      landing: role === "Admin" ? undefined : "demoted",
      run: (personIds, settled) => {
        change.mutate({ personIds, role }, settled);
      },
    });
  };

  return (
    <BulkDialog
      acts={acts}
      act="role"
      title={BULK_WORDS.changeRole.title(count)}
      consequence={BULK_WORDS.changeRole.consequence}
      commit={<Button onClick={commit}>{BULK_WORDS.changeRole.commit(count, role)}</Button>}
    >
      <RoleChoice role={role} onChoose={acts.setRole} />
    </BulkDialog>
  );
}

function GroupChoice(properties: { readonly acts: Acts; readonly groups: typeof NO_GROUPS }) {
  const { acts, groups } = properties;
  const id = useId();
  if (groups.length === 0) {
    return (
      <EmptyState
        line={EMPTY_LINES.groups}
        className="gap-1"
        action={
          <Link to={GROUPS_SCREEN} className="text-brand underline">
            Create one on the Groups screen
          </Link>
        }
      />
    );
  }
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Group</Label>
      <Select value={acts.groupId ?? ""} onValueChange={acts.setGroupId}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={BULK_WORDS.addToGroup.choose} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AddToGroupDialog(properties: { readonly acts: Acts }) {
  const { acts } = properties;
  const groups = useGroups().data ?? NO_GROUPS;
  const add = useBulkAddToGroup();
  const count = acts.asked.length;
  const chosen = groups.find((group) => group.id === acts.groupId);

  const commit = () => {
    if (chosen === undefined) return;
    acts.command({
      pending: BULK_WORDS.addToGroup.pending(count, chosen.name),
      done: (answer) =>
        BULK_WORDS.addToGroup.done(answer.changed.length, chosen.name, answer.skipped),
      landing: undefined,
      run: (personIds, settled) => {
        add.mutate({ groupId: chosen.id, personIds }, settled);
      },
    });
  };

  return (
    <BulkDialog
      acts={acts}
      act="group"
      title={BULK_WORDS.addToGroup.title(count)}
      consequence={BULK_WORDS.addToGroup.consequence}
      commit={
        <Button disabled={chosen === undefined} onClick={commit}>
          {chosen === undefined
            ? BULK_WORDS.addToGroup.act
            : BULK_WORDS.addToGroup.commit(count, chosen.name)}
        </Button>
      }
    >
      <GroupChoice acts={acts} groups={groups} />
    </BulkDialog>
  );
}

function RemoveDialog(properties: { readonly acts: Acts }) {
  const { acts } = properties;
  const remove = useBulkRemove();
  const count = acts.asked.length;

  const commit = () => {
    acts.command({
      pending: BULK_WORDS.remove.pending(count),
      done: (answer) => BULK_WORDS.remove.done(answer.changed.length, answer.skipped),
      landing: "removed",
      run: (personIds, settled) => {
        remove.mutate({ personIds }, settled);
      },
    });
  };

  return (
    <BulkDialog
      acts={acts}
      act="remove"
      title={BULK_WORDS.remove.title(count)}
      consequence={BULK_WORDS.remove.consequence}
      commit={
        <Button variant="destructive" onClick={commit}>
          {BULK_WORDS.remove.commit(count)}
        </Button>
      }
    />
  );
}

/** Mounted with the list, so an act still pending when its dialog shuts keeps its answer. */
export function MemberBulkDialogs(properties: { readonly acts: Acts }) {
  return (
    <>
      <ChangeRoleDialog acts={properties.acts} />
      <AddToGroupDialog acts={properties.acts} />
      <RemoveDialog acts={properties.acts} />
    </>
  );
}
