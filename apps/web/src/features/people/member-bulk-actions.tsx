import { Link } from "@tanstack/react-router";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { ActionDialog } from "@/shared/action-dialog.tsx";
import type { ApiError } from "@/shared/api/trpc.ts";
import { EmptyState } from "@/shared/empty-state.tsx";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { saidOfItems, setRefusalOutcome } from "@/shared/refusal-outcome.tsx";
import { SelectionAction } from "@/shared/selection-bar.tsx";
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
import { useGroups, type ListedGroup } from "./groups-api.ts";
import { GroupsReadSaid } from "./groups-read.tsx";
import { BULK_WORDS, NO_LONGER_LISTED } from "./member-action-words.ts";
import { NO_MARKS, type RefusedRows } from "./member-columns.tsx";
import { GROUPS_PATH } from "./members-address.ts";
import {
  useBulkAddToGroup,
  useBulkChangeRole,
  useBulkRemove,
  useReaderId,
  type BulkChanged,
  type Role,
} from "./people-api.ts";
import { PEOPLE_KEYSTROKES as KEY, shortcutOf } from "./people-state.ts";
import { SAID_OF_TICKED_MEMBERS } from "./refusal-words.ts";
import { ROLE_OFFERED_FIRST, RoleChoice } from "./role-choice.tsx";
import { useIncludesYou, useSelfActionHome } from "./self-action.tsx";

type BulkAction = "role" | "group" | "remove";

type Settled = {
  readonly onSuccess: (answer: BulkChanged) => void;
  readonly onError: (failure: Error | ApiError) => void;
};

/** What the list hands its bulk actions: the ticks, and where an action's outcome and marks land. */
export type BulkList = {
  /** False while the list's read waits or has failed, when its rows are not there to act on. */
  readonly readable: boolean;
  readonly ticked: ReadonlySet<string>;
  readonly tick: (ticked: ReadonlySet<string>) => void;
  readonly nameOf: (personId: string) => string;
  readonly heading: RefObject<HTMLElement | null>;
  readonly say: (outcome: Outcome | undefined) => void;
  readonly mark: (refused: RefusedRows) => void;
};

const NOTHING_TICKED = selectFirst("member");

const STILL_GOING: Outcome = { tone: "said", words: BULK_WORDS.stillGoing };

/** Matches the api's cap for one action, which refuses any more as input it cannot read. */
const MOST_TICKED = 200;

const TOO_MANY: Outcome = { tone: "said", words: BULK_WORDS.tooMany(MOST_TICKED) };

const refusedRowsOf = (failure: Error | ApiError): RefusedRows =>
  new Map(saidOfItems(SAID_OF_TICKED_MEMBERS, failure).map(({ id, said }) => [id, said]));

/** Names are taken at the press, so a person the list has since lost is still named. */
const refusalOf = (failure: Error | ApiError, names: ReadonlyMap<string, string>): Outcome =>
  setRefusalOutcome({
    featureWords: SAID_OF_TICKED_MEMBERS,
    failure,
    nameOf: (personId) => names.get(personId) ?? NO_LONGER_LISTED,
    lead: BULK_WORDS.refused,
  });

export const useMemberBulkActions = (list: BulkList) => {
  const [open, setOpen] = useState<BulkAction>();
  const [asked, setAsked] = useState<readonly string[]>([]);
  const [role, setRole] = useState<Role>(ROLE_OFFERED_FIRST);
  const [groupId, setGroupId] = useState<string>();
  // One action at a time: a dialog's second call on its mutation takes over the first's callbacks.
  const [acting, setActing] = useState(false);
  const opener = useRef<HTMLElement>(null);
  const sent = useRef(false);
  const readerId = useReaderId();
  const { goHome } = useSelfActionHome();

  const show = (action: BulkAction) => {
    // The failed or waiting read already says why there is no list to act on.
    if (!list.readable) return;
    if (acting) {
      list.say(STILL_GOING);
      return;
    }
    if (list.ticked.size === 0) {
      list.say(NOTHING_TICKED);
      return;
    }
    if (list.ticked.size > MOST_TICKED) {
      list.say(TOO_MANY);
      return;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sent.current = false;
    setAsked([...list.ticked]);
    setRole(ROLE_OFFERED_FIRST);
    setGroupId(undefined);
    setOpen(action);
  };

  /** A sent action spends the ticks that showed its button, so focus goes to the list it changed. */
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (!sent.current) opener.current?.focus();
    if (document.activeElement !== opener.current || sent.current) list.heading.current?.focus();
  };

  /** Spent at the press, so the action reads as taken within a tenth of a second. */
  const command = (said: {
    readonly pending: string;
    readonly done: (answer: BulkChanged) => string;
    readonly ownChange: "demoted" | "removed" | undefined;
    readonly run: (personIds: string[], settled: Settled) => void;
  }) => {
    if (acting) return;
    const names = new Map(asked.map((personId) => [personId, list.nameOf(personId)]));
    const yourOwn = readerId !== undefined && asked.includes(readerId) ? said.ownChange : undefined;
    sent.current = true;
    setActing(true);
    setOpen(undefined);
    list.tick(new Set());
    list.mark(NO_MARKS);
    list.say({ tone: "said", words: said.pending });
    said.run([...asked], {
      onSuccess: (answer) => {
        setActing(false);
        list.say({ tone: "said", words: said.done(answer) });
        if (yourOwn === undefined) return;
        void goHome(yourOwn).then((unread) => {
          if (unread !== undefined) list.say(unread);
        });
      },
      onError: (failure) => {
        setActing(false);
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

  // A read failing under an open dialog shuts it for good, rather than reopening it once read.
  if (!list.readable && open !== undefined) setOpen(undefined);

  return {
    open,
    setOpen,
    asked,
    role,
    setRole,
    groupId,
    setGroupId,
    acting,
    show,
    returnFocus,
    command,
  };
};

type Actions = ReturnType<typeof useMemberBulkActions>;

const BAR_ACTIONS: readonly {
  readonly action: BulkAction;
  readonly keystroke: Keystroke;
  readonly label: string;
}[] = [
  { action: "role", keystroke: KEY.changeSelectedRoles, label: BULK_WORDS.changeRole.action },
  { action: "group", keystroke: KEY.addSelectedToGroup, label: BULK_WORDS.addToGroup.action },
  { action: "remove", keystroke: KEY.removeSelected, label: BULK_WORDS.remove.action },
];

/** The bar's actions; each opens one dialog holding its value and its confirmation. */
export function MemberBulkActions(properties: { readonly actions: Actions }) {
  const { actions } = properties;
  return (
    <>
      {BAR_ACTIONS.map(({ action, keystroke, label }) => (
        <SelectionAction
          key={action}
          aria-keyshortcuts={shortcutOf(keystroke)}
          aria-disabled={actions.acting}
          className="aria-disabled:opacity-50"
          onClick={() => {
            actions.show(action);
          }}
        >
          {label}
        </SelectionAction>
      ))}
    </>
  );
}

function BulkDialog(properties: {
  readonly actions: Actions;
  readonly action: BulkAction;
  readonly title: string;
  readonly consequence: string;
  readonly commit: ReactNode;
  readonly children?: ReactNode;
}) {
  const { actions } = properties;
  const includesYou = useIncludesYou(actions.asked);
  return (
    <ActionDialog
      open={actions.open === properties.action}
      onOpenChange={(open) => {
        if (!open) actions.setOpen(undefined);
      }}
      content={{ className: "wrap-anywhere", onCloseAutoFocus: actions.returnFocus }}
      title={properties.title}
      consequence={properties.consequence}
      commit={properties.commit}
    >
      {includesYou === undefined ? null : <p className="font-medium">{includesYou}</p>}
      {properties.children}
    </ActionDialog>
  );
}

function ChangeRoleDialog(properties: { readonly actions: Actions }) {
  const { actions } = properties;
  const change = useBulkChangeRole();
  const count = actions.asked.length;
  const { role } = actions;

  const commit = () => {
    actions.command({
      pending: BULK_WORDS.changeRole.pending(count, role),
      done: (answer) => BULK_WORDS.changeRole.done(answer.changed.length, role, answer.skipped),
      ownChange: role === "Admin" ? undefined : "demoted",
      run: (personIds, settled) => {
        change.mutate({ personIds, role }, settled);
      },
    });
  };

  return (
    <BulkDialog
      actions={actions}
      action="role"
      title={BULK_WORDS.changeRole.title(count)}
      consequence={BULK_WORDS.changeRole.consequence}
      commit={<Button onClick={commit}>{BULK_WORDS.changeRole.commit(count, role)}</Button>}
    >
      <RoleChoice role={role} onChoose={actions.setRole} />
    </BulkDialog>
  );
}

function GroupSelect(properties: {
  readonly actions: Actions;
  readonly groups: readonly ListedGroup[];
}) {
  const { actions, groups } = properties;
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Group</Label>
      <Select value={actions.groupId ?? ""} onValueChange={actions.setGroupId}>
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

/** Only an answered read may say there are no groups; a waiting or failed one says so instead. */
function GroupChoice(properties: {
  readonly actions: Actions;
  readonly groups: ReturnType<typeof useGroups>;
}) {
  const { actions, groups } = properties;
  return (
    <>
      <GroupsReadSaid error={groups.error} isPending={groups.isPending} />
      {groups.data?.length === 0 ? (
        <EmptyState
          line={EMPTY_LINES.groups}
          className="gap-1"
          action={
            <Link to={GROUPS_PATH} className="text-brand underline">
              Create one on the Groups page
            </Link>
          }
        />
      ) : null}
      {groups.data === undefined || groups.data.length === 0 ? null : (
        <GroupSelect actions={actions} groups={groups.data} />
      )}
    </>
  );
}

function AddToGroupDialog(properties: { readonly actions: Actions }) {
  const { actions } = properties;
  const groups = useGroups();
  const add = useBulkAddToGroup();
  const count = actions.asked.length;
  const chosen = groups.data?.find((group) => group.id === actions.groupId);

  const commit = () => {
    if (chosen === undefined) return;
    actions.command({
      pending: BULK_WORDS.addToGroup.pending(count, chosen.name),
      done: (answer) =>
        BULK_WORDS.addToGroup.done(answer.changed.length, chosen.name, answer.skipped),
      ownChange: undefined,
      run: (personIds, settled) => {
        add.mutate({ groupId: chosen.id, personIds }, settled);
      },
    });
  };

  return (
    <BulkDialog
      actions={actions}
      action="group"
      title={BULK_WORDS.addToGroup.title(count)}
      consequence={BULK_WORDS.addToGroup.consequence}
      commit={
        <Button disabled={chosen === undefined} onClick={commit}>
          {chosen === undefined
            ? BULK_WORDS.addToGroup.action
            : BULK_WORDS.addToGroup.commit(count, chosen.name)}
        </Button>
      }
    >
      <GroupChoice actions={actions} groups={groups} />
    </BulkDialog>
  );
}

function RemoveDialog(properties: { readonly actions: Actions }) {
  const { actions } = properties;
  const remove = useBulkRemove();
  const count = actions.asked.length;

  const commit = () => {
    actions.command({
      pending: BULK_WORDS.remove.pending(count),
      done: (answer) => BULK_WORDS.remove.done(answer.changed.length, answer.skipped),
      ownChange: "removed",
      run: (personIds, settled) => {
        remove.mutate({ personIds }, settled);
      },
    });
  };

  return (
    <BulkDialog
      actions={actions}
      action="remove"
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

/** Mounted with the list, so an action still pending when its dialog shuts keeps its answer. */
export function MemberBulkDialogs(properties: { readonly actions: Actions }) {
  return (
    <>
      <ChangeRoleDialog actions={properties.actions} />
      <AddToGroupDialog actions={properties.actions} />
      <RemoveDialog actions={properties.actions} />
    </>
  );
}
