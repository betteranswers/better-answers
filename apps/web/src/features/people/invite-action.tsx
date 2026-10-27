import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type SubmitEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import { useAsked } from "@/shared/address-ask.ts";
import { Address } from "@/shared/address.tsx";
import { refusalOf } from "@/shared/api/trpc.ts";
import { Icon } from "@/shared/icon.tsx";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { INVITE_A_PERSON } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusedWith, setRefusalOutcome } from "@/shared/refusal-outcome.tsx";
import type { OwnSentences } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { INVITE_REFUSED, INVITE_WORDS, invitedOutcome } from "./invitation-words.ts";
import { useInvite, type InvitedOne, type SentInvitation } from "./invitations-api.ts";
import {
  addressesCounted,
  allInto,
  flagOf,
  flagsFrom,
  hasSeparator,
  membersOf,
  MOST_AT_ONCE,
  typedInto,
  type Flag,
  type Held,
  type Moved,
} from "./invite-addresses.ts";
import { useMembers, type ListedMember, type Role } from "./people-api.ts";
import { PEOPLE_KEYSTROKES } from "./people-state.ts";
import { outcomeOfSendingFailure } from "./refusal.tsx";
import { ROLE_OFFERED_FIRST, RoleChoice } from "./role-choice.tsx";
import { UnsentEmails } from "./unsent-emails.tsx";

const ACTION_NAME = PEOPLE_KEYSTROKES.invite.action;

type AnsweredAway = {
  readonly outcome: Outcome;
  readonly unsent: readonly SentInvitation[];
  readonly left: string;
};

type OnAnsweredAway = (answered: AnsweredAway) => void;

const NOTHING_UNSENT: readonly SentInvitation[] = [];

const FLAGGED_BY_THE_API = {
  malformed: INVITE_WORDS.flag.malformed,
  "already-a-member": INVITE_WORDS.flag["already-a-member"],
} satisfies OwnSentences;

const heldBackOutcome = (failure: Error, held: readonly Held[]): Outcome =>
  flagsFrom(held, refusalOf(failure)?.items ?? {}).size === 0
    ? outcomeOfSendingFailure(failure)
    : setRefusalOutcome({
        featureWords: FLAGGED_BY_THE_API,
        failure,
        nameOf: (place) => held[Number(place)]?.address ?? "",
        lead: INVITE_REFUSED.heldBack,
      });

export const useInviteAction = (say: (outcome: Outcome) => void) => {
  const [unsent, setUnsent] = useState(NOTHING_UNSENT);
  const onAnsweredAway: OnAnsweredAway = (answered) => {
    say(answered.outcome);
    setUnsent(answered.unsent);
  };
  return { action: <InviteAction onAnsweredAway={onAnsweredAway} />, unsent, setUnsent };
};

const NO_FLAGS: ReadonlyMap<string, Flag> = new Map();

const NOTHING_HELD: readonly Held[] = [];

const CAPPED = refusedWith(INVITE_REFUSED.capped(MOST_AT_ONCE));

type FieldRef = RefObject<HTMLInputElement | null>;

type ListRef = RefObject<HTMLUListElement | null>;

const pastedInto = (event: ClipboardEvent<HTMLInputElement>): string | undefined => {
  const pasted = event.clipboardData.getData("text");
  if (!hasSeparator(pasted)) return undefined;
  const { value, selectionStart, selectionEnd } = event.currentTarget;
  return `${value.slice(0, selectionStart ?? value.length)}${pasted}${value.slice(selectionEnd ?? value.length)}`;
};

const useHeldAddresses = (members: ReadonlySet<string>, list: ListRef, left: string) => {
  const [held, setHeld] = useState(NOTHING_HELD);
  const [field, setField] = useState(left);
  const [refused, setRefused] = useState(NO_FLAGS);
  const removers = useRef(new Map<string, HTMLButtonElement>());
  const flags = held.map((one) => flagOf(one, members, refused));

  const place = (moved: Moved) => {
    setHeld(moved.held);
    setField(moved.field);
  };

  const placedNow = (moved: Moved): readonly Held[] => {
    flushSync(() => {
      place(moved);
    });
    return moved.held;
  };

  const isFlagged = (one: Held): boolean => flagOf(one, members, refused) !== undefined;

  const focusFirstFlagged = () => {
    list.current?.querySelector<HTMLElement>("[data-flagged] button")?.focus();
  };

  const flagNow = (byTheApi: ReadonlyMap<string, Flag>) => {
    flushSync(() => {
      setRefused((before) => new Map([...before, ...byTheApi]));
    });
    focusFirstFlagged();
  };

  const removeRefOf = (key: string) => (button: HTMLButtonElement) => {
    removers.current.set(key, button);
    return () => {
      removers.current.delete(key);
    };
  };

  const remove = (key: string, fieldRef: FieldRef) => {
    const at = held.findIndex((one) => one.key === key);
    const kept = held.filter((one) => one.key !== key);
    flushSync(() => {
      setHeld(kept);
    });
    const next = kept[at] ?? kept[at - 1];
    (next === undefined ? fieldRef.current : removers.current.get(next.key))?.focus();
  };

  return {
    held,
    field,
    flags,
    place,
    placedNow,
    isFlagged,
    focusFirstFlagged,
    flagNow,
    removeRefOf,
    remove,
  };
};

type Addresses = ReturnType<typeof useHeldAddresses>;

function HeldRow(properties: {
  readonly one: Held;
  readonly flag: Flag | undefined;
  readonly removeRef: (button: HTMLButtonElement) => () => void;
  readonly onRemove: () => void;
}) {
  const { one, flag, removeRef } = properties;
  const flagId = useId();
  return (
    <li
      data-flagged={flag === undefined ? undefined : true}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1 last:border-b-0"
    >
      <Address address={one.address} className="min-w-40 flex-1 text-sm" />
      <Pill
        id={flagId}
        variant="outline"
        className={flag === undefined ? "py-0.5" : "border-destructive py-0.5 text-destructive"}
      >
        {INVITE_WORDS.flag[flag ?? "ready"]}
      </Pill>
      <Button
        ref={removeRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={INVITE_WORDS.remove(one.address)}
        aria-describedby={flagId}
        onClick={properties.onRemove}
      >
        <Icon name="remove" />
      </Button>
    </li>
  );
}

function HeldList(properties: {
  readonly addresses: Addresses;
  readonly list: ListRef;
  readonly fieldRef: FieldRef;
}) {
  const { addresses, list, fieldRef } = properties;
  if (addresses.held.length === 0) return null;
  return (
    <ul
      ref={list}
      aria-label={INVITE_WORDS.list}
      className="max-h-56 overflow-y-auto border border-border"
    >
      {addresses.held.map((one, at) => (
        <HeldRow
          key={one.key}
          one={one}
          flag={addresses.flags[at]}
          removeRef={addresses.removeRefOf(one.key)}
          onRemove={() => {
            addresses.remove(one.key, fieldRef);
          }}
        />
      ))}
    </ul>
  );
}

const summaryOf = (addresses: Addresses): string => {
  const flagged = addresses.flags.filter((flag) => flag !== undefined).length;
  return addresses.held.length === 0
    ? ""
    : INVITE_WORDS.summary(addresses.held.length - flagged, flagged);
};

function AddressField(properties: {
  readonly addresses: Addresses;
  readonly list: ListRef;
  readonly fieldRef: FieldRef;
  readonly onCapped: () => void;
}) {
  const { addresses, list, fieldRef } = properties;
  const ids = { field: useId(), hint: useId(), summary: useId() };
  const placed = (moved: Moved) => {
    addresses.place(moved);
    if (moved.capped) properties.onCapped();
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={ids.field}>{INVITE_WORDS.field}</Label>
      <Input
        ref={fieldRef}
        id={ids.field}
        type="text"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={`${ids.hint} ${ids.summary}`}
        value={addresses.field}
        onChange={(event) => {
          placed(typedInto(addresses.held, event.target.value));
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || addresses.field.trim() === "") return;
          event.preventDefault();
          placed(allInto(addresses.held, addresses.field));
        }}
        onPaste={(event) => {
          const whole = pastedInto(event);
          if (whole === undefined) return;
          event.preventDefault();
          placed(allInto(addresses.held, whole));
        }}
      />
      <p id={ids.hint} className="text-sm text-muted-foreground">
        {INVITE_WORDS.hint}
      </p>
      <output id={ids.summary} className="text-sm empty:hidden">
        {summaryOf(addresses)}
      </output>
      <HeldList addresses={addresses} list={list} fieldRef={fieldRef} />
    </div>
  );
}

const withWaiting = (outcome: Outcome | undefined, waiting: number): Outcome | undefined =>
  outcome === undefined || waiting === 0
    ? outcome
    : {
        ...outcome,
        words: (
          <>
            {outcome.words} <span className="block">{INVITE_WORDS.waiting(waiting)}</span>
          </>
        ),
      };

function Sent(properties: {
  readonly sent: readonly InvitedOne[];
  readonly waiting: boolean;
  readonly onAgain: () => void;
}) {
  const { waiting } = properties;
  return (
    <>
      <UnsentEmails unsent={properties.sent.filter((one) => !one.emailSent)} />
      <DialogFooter>
        <Button
          type="button"
          variant={waiting ? "default" : "outline"}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the control that had focus is gone, and the addresses waiting are where the action leads
          autoFocus={waiting}
          onClick={properties.onAgain}
        >
          {ACTION_NAME}
        </Button>
        <DialogClose asChild>
          {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- the control that had focus is gone, and this is where the action leaves the reader */}
          <Button type="button" variant={waiting ? "outline" : "default"} autoFocus={!waiting}>
            {INVITE_WORDS.done}
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

function InviteForm(properties: {
  readonly members: readonly ListedMember[] | undefined;
  readonly fieldRef: FieldRef;
  readonly left: string;
  readonly onAgain: (left: string) => void;
  readonly onAnsweredAway: OnAnsweredAway;
}) {
  const { fieldRef, members } = properties;
  const invite = useInvite();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const list = useRef<HTMLUListElement>(null);
  const known = useMemo(
    () => membersOf((members ?? []).map((member) => member.address)),
    [members],
  );
  const addresses = useHeldAddresses(known, list, properties.left);
  const [role, setRole] = useState<Role>(ROLE_OFFERED_FIRST);
  const [outcome, setOutcome] = useState<Outcome>();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<readonly InvitedOne[]>();
  const formId = useId();
  const toSend = allInto(addresses.held, addresses.field).held.length;
  const waiting = sent === undefined ? 0 : addressesCounted(addresses.field);

  const refusedBefore = (held: readonly Held[]): Outcome | undefined => {
    if (held.some(addresses.isFlagged)) {
      addresses.focusFirstFlagged();
      return refusedWith(INVITE_REFUSED.flagged);
    }
    if (held.length > 0) return undefined;
    fieldRef.current?.focus();
    return refusedWith(INVITE_REFUSED.none);
  };

  const send = (held: readonly Held[]) => {
    setSending(true);
    setOutcome(undefined);
    // Not `mutate`: its callbacks die with this form, which a closed dialog unmounts.
    invite.mutateAsync({ addresses: held.map((one) => one.address), role }).then(
      ({ invitations }) => {
        const invited = invitedOutcome(invitations, role);
        if (!mounted.current) {
          properties.onAnsweredAway({
            outcome: invited,
            unsent: invitations.filter((one) => !one.emailSent),
            left: "",
          });
          return;
        }
        setSending(false);
        setSent(invitations);
        setOutcome(invited);
      },
      (failure: Error) => {
        if (!mounted.current) {
          properties.onAnsweredAway({
            outcome: heldBackOutcome(failure, held),
            unsent: NOTHING_UNSENT,
            left: held.map((one) => one.address).join(", "),
          });
          return;
        }
        setSending(false);
        const flagged = flagsFrom(held, refusalOf(failure)?.items ?? {});
        if (flagged.size === 0) {
          setOutcome(outcomeOfSendingFailure(failure));
          return;
        }
        addresses.flagNow(flagged);
        setOutcome(refusedWith(INVITE_REFUSED.flagged));
      },
    );
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const held = addresses.placedNow(allInto(addresses.held, addresses.field));
    const refused = refusedBefore(held);
    if (refused === undefined) send(held);
    else setOutcome(refused);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{ACTION_NAME}</DialogTitle>
        <DialogDescription>{INVITE_WORDS.description}</DialogDescription>
      </DialogHeader>

      <OutcomeLine outcome={withWaiting(outcome, waiting)} className="text-sm" />

      {sent === undefined ? (
        <>
          <form id={formId} noValidate onSubmit={submit} className="grid gap-4">
            <AddressField
              addresses={addresses}
              list={list}
              fieldRef={fieldRef}
              onCapped={() => {
                setOutcome(CAPPED);
              }}
            />
            <RoleChoice role={role} onChoose={setRole} />
          </form>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              form={formId}
              aria-disabled={sending || addresses.flags.some((flag) => flag !== undefined)}
              className="aria-disabled:opacity-50"
            >
              {sending ? INVITE_WORDS.sending(toSend) : INVITE_WORDS.send(toSend)}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <Sent
          sent={sent}
          waiting={waiting > 0}
          onAgain={() => {
            properties.onAgain(addresses.field);
          }}
        />
      )}
    </>
  );
}

function InviteAction(properties: { readonly onAnsweredAway: OnAnsweredAway }) {
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState(0);
  const [left, setLeft] = useState("");
  const fieldRef = useRef<HTMLInputElement>(null);
  const members = useMembers().data;

  const show = () => {
    setOpen(true);
  };
  useKeystroke(PEOPLE_KEYSTROKES.invite, show);
  useAsked("action", (action) => {
    if (action === INVITE_A_PERSON.asks) show();
  });

  const again = (leftInTheField: string) => {
    flushSync(() => {
      setLeft(leftInTheField);
      setInvites((count) => count + 1);
    });
    fieldRef.current?.focus();
  };

  const openedOrClosed = (opened: boolean) => {
    setOpen(opened);
    if (!opened) setLeft("");
  };

  return (
    <Dialog open={open} onOpenChange={openedOrClosed}>
      <DialogTrigger asChild>
        <Button size="sm" aria-keyshortcuts={PEOPLE_KEYSTROKES.invite.key}>
          {ACTION_NAME}
        </Button>
      </DialogTrigger>
      <DialogContent className="wrap-anywhere">
        <InviteForm
          key={invites}
          members={members}
          fieldRef={fieldRef}
          left={left}
          onAgain={again}
          onAnsweredAway={(answered) => {
            setLeft(answered.left);
            properties.onAnsweredAway(answered);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
