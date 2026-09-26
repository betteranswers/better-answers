import { Link } from "@tanstack/react-router";
import { useId, useRef, useState, type RefObject } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { EmptyState } from "@/shared/empty-state.tsx";
import { Icon } from "@/shared/icon.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { RowSheet } from "@/shared/row-sheet.tsx";
import { screenById, viewNamed } from "@/shared/screens.ts";
import { SheetPart } from "@/shared/sheet-part.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group.tsx";
import { SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet.tsx";
import { instantWords } from "@/shared/words.ts";

import { EMPTY_LINES } from "./empty-lines.ts";
import { GroupChecklist } from "./group-checklist.tsx";
import { useGroups } from "./groups-api.ts";
import { MemberRemoval } from "./member-removal.tsx";
import {
  useChangeRole,
  useFlagDisplayName,
  useReaderId,
  useRevokeCredentials,
  type CredentialsRevokedHere,
  type ListedMember,
  type Role,
  type RoleChanged,
} from "./people-api.ts";
import { outcomeOfFailure, outcomeOfGroupFailure } from "./refusal.tsx";
import { aRole, ROLE_MEANINGS, roleOf, ROLES } from "./role-meanings.ts";
import { CredentialsHere, GroupPills, JoinedOn, nameOf, RECORDED } from "./words.tsx";

/** Where focus lands when the sheet opens: on who the member is, or straight on an act. */
export type OpenedAt = "member" | "role" | "groups" | "credentials" | "flag" | "removal";

export const memberButtonId = (personId: string): string => `member-${personId}`;

const GROUPS_VIEW = viewNamed(screenById("people"), "Groups").path;

const initialsOf = (member: ListedMember): string =>
  nameOf(member)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

function Membership(properties: { readonly member: ListedMember }) {
  const { member } = properties;
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="border border-border">
      <h3 id={headingId} className="border-b border-border px-4 py-2 font-medium">
        Membership
      </h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <SummaryRow term="Role">
          <Pill>{member.role}</Pill>
        </SummaryRow>
        <SummaryRow term="Groups">
          <GroupPills groups={member.groups} />
        </SummaryRow>
        <SummaryRow term="Joined">
          <JoinedOn instant={member.joinedAt} />
        </SummaryRow>
        <SummaryRow term="Credentials here">
          <CredentialsHere revokedAt={member.credentialsRevokedAt} />
        </SummaryRow>
      </dl>
    </section>
  );
}

function RolePicker(properties: {
  readonly member: ListedMember;
  readonly pickerRef: RefObject<HTMLDivElement | null>;
}) {
  const { member, pickerRef } = properties;
  const [picked, setPicked] = useState<Role>(member.role);
  const [outcome, setOutcome] = useState<Outcome>();
  const changeRole = useChangeRole();
  const headingId = useId();
  const hintId = useId();
  const itemId = useId();
  const name = nameOf(member);

  /**
   * Focus moves to the picker first: the button it leaves is disabled once the row takes the
   * role.
   */
  const commit = () => {
    pickerRef.current?.querySelector<HTMLElement>(`[value="${picked}"]`)?.focus();
    setOutcome(undefined);
    changeRole.mutate(
      { personId: member.personId, role: picked },
      {
        onSuccess: (changed: RoleChanged) => {
          setOutcome({
            tone: "said",
            words: `${name} is ${aRole(changed.role)} now, from their next request.`,
          });
        },
        onError: (failure: Error | ApiError) => {
          setOutcome(outcomeOfFailure(failure));
        },
      },
    );
  };

  const unchanged = picked === member.role;

  return (
    <section aria-labelledby={headingId} className="border border-border">
      <h3 id={headingId} className="border-b border-border px-4 py-2 font-medium">
        Role
      </h3>
      <div className="grid gap-4 px-4 py-3">
        <RadioGroup
          ref={pickerRef}
          aria-labelledby={headingId}
          value={picked}
          onValueChange={(value) => {
            setPicked(roleOf(value) ?? picked);
          }}
        >
          {ROLES.map((role) => (
            <div key={role} className="flex items-start gap-3">
              <RadioGroupItem
                id={`${itemId}-${role}`}
                value={role}
                className="mt-0.5"
                aria-describedby={`${itemId}-${role}-meaning`}
              />
              <div className="grid gap-0.5">
                <Label htmlFor={`${itemId}-${role}`} className="font-medium">
                  {role}
                </Label>
                <span id={`${itemId}-${role}-meaning`} className="text-xs text-muted-foreground">
                  {ROLE_MEANINGS[role]}
                </span>
              </div>
            </div>
          ))}
        </RadioGroup>

        <div className="flex flex-col items-start gap-2">
          <Button disabled={unchanged} aria-describedby={hintId} onClick={commit}>
            Make {name} {aRole(picked)}
          </Button>
          <p id={hintId} className="text-sm text-muted-foreground">
            {unchanged
              ? `${name} is ${aRole(member.role)}. Pick another role to change it.`
              : `${RECORDED} It holds from their next request.`}
          </p>
        </div>

        <OutcomeLine outcome={outcome} />
      </div>
    </section>
  );
}

function CredentialsRevoker(properties: {
  readonly member: ListedMember;
  readonly revokeRef: RefObject<HTMLButtonElement | null>;
}) {
  const { member, revokeRef } = properties;
  const [outcome, setOutcome] = useState<Outcome>();
  const revoke = useRevokeCredentials();
  const readerId = useReaderId();
  const hintId = useId();
  const name = nameOf(member);

  const commit = () => {
    if (revoke.isPending) return;
    setOutcome(undefined);
    revoke.mutate(
      { personId: member.personId },
      {
        onSuccess: (revoked: CredentialsRevokedHere) => {
          setOutcome({
            tone: "said",
            words: `${name}'s credentials here are revoked. Every session and token issued before ${instantWords(revoked.revokedAt)} is refused here; a fresh sign-in works.`,
          });
        },
        onError: (failure: Error | ApiError) => {
          setOutcome(outcomeOfFailure(failure));
        },
      },
    );
  };

  return (
    <SheetPart title="Credentials">
      <div className="flex flex-col items-start gap-2">
        <Button
          ref={revokeRef}
          variant="outline"
          aria-describedby={hintId}
          // Not `disabled`: a disabled button drops the focus the act leaves on it.
          aria-disabled={revoke.isPending}
          onClick={commit}
        >
          Revoke {name}'s credentials here
        </Button>
        <p id={hintId} className="text-sm text-muted-foreground">
          Every session and token {name} holds for this workspace is refused at once, and a fresh
          sign-in works.{" "}
          {member.personId === readerId ? "Your own session here ends with it." : RECORDED}
        </p>
      </div>

      <OutcomeLine outcome={outcome} />
    </SheetPart>
  );
}

/** Shown at the press, since the answer is this for every member; a refusal replaces it. */
const SENT_TO_THE_OPERATOR: Outcome = {
  tone: "said",
  words: "Sent to the operator. The name stands until they correct it.",
};

function DisplayNameFlag(properties: {
  readonly member: ListedMember;
  readonly flagRef: RefObject<HTMLButtonElement | null>;
}) {
  const { member, flagRef } = properties;
  const [outcome, setOutcome] = useState<Outcome>();
  const flagName = useFlagDisplayName();
  const hintId = useId();

  const flag = () => {
    setOutcome(SENT_TO_THE_OPERATOR);
    flagName.mutate(
      { personId: member.personId },
      {
        onError: (failure: Error | ApiError) => {
          setOutcome(outcomeOfFailure(failure));
        },
      },
    );
  };

  return (
    <SheetPart title="Display name">
      {member.displayName === "" ? (
        <p className="text-sm text-muted-foreground wrap-anywhere">
          {member.address} has given no display name yet, so there is none to flag.
        </p>
      ) : (
        <>
          <p className="text-sm">
            People give their own display name, and no Admin can change one. The operator corrects a
            name you flag as inappropriate.
          </p>
          <div className="flex flex-col items-start gap-2">
            <Button ref={flagRef} variant="outline" aria-describedby={hintId} onClick={flag}>
              <Icon name="flag" />
              Flag the name to the operator
            </Button>
            <p id={hintId} className="text-sm text-muted-foreground">
              The operator is emailed, and the flag is recorded on the audit log under your name.
              While a flag from this workspace waits, another adds nothing.
            </p>
          </div>
          <OutcomeLine outcome={outcome} />
        </>
      )}
    </SheetPart>
  );
}

function GroupsPicker(properties: {
  readonly member: ListedMember;
  readonly pickerRef: RefObject<HTMLDivElement | null>;
}) {
  const { member, pickerRef } = properties;
  const groups = useGroups();
  const name = nameOf(member);
  const held = new Set<string>(member.groups.map((group) => group.groupId));
  const workspaceGroups = groups.data ?? [];

  return (
    <SheetPart title="Groups">
      <OutcomeLine
        outcome={groups.error === null ? undefined : outcomeOfGroupFailure(groups.error)}
      />
      <div aria-live="polite" className="empty:hidden">
        {groups.isPending ? <p>The groups are still loading.</p> : null}
      </div>
      <div ref={pickerRef} className="contents">
        {groups.data?.length === 0 ? (
          <EmptyState
            line={EMPTY_LINES.groups}
            className="gap-1"
            action={
              <Link to={GROUPS_VIEW} className="text-brand underline">
                Create one on the Groups view
              </Link>
            }
          />
        ) : null}
        {workspaceGroups.length === 0 ? null : (
          <GroupChecklist
            legend={`Groups ${name} is in`}
            hint={`Each box puts ${name} in its group or takes them out at once.`}
            choices={workspaceGroups.map((group) => ({
              id: group.id,
              label: group.name,
              detail: undefined,
              checked: held.has(group.id),
            }))}
            pairOf={(groupId) => {
              const group = workspaceGroups.find((candidate) => candidate.id === groupId);
              return group === undefined
                ? undefined
                : {
                    inGroup: { groupId, userId: member.personId },
                    person: name,
                    group: group.name,
                  };
            }}
          />
        )}
      </div>
    </SheetPart>
  );
}

export function MemberSheet(properties: {
  readonly member: ListedMember;
  readonly openedAt: OpenedAt;
  readonly onClose: () => void;
  readonly onRemove: (member: ListedMember) => void;

  /** The member's own row may be gone by then, so the list decides where focus lands. */
  readonly returnFocus: () => void;
}) {
  const { member, openedAt, onClose, onRemove, returnFocus } = properties;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const flagRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);

  const landOn = {
    member: () => titleRef.current,
    role: () => pickerRef.current?.querySelector<HTMLElement>('[aria-checked="true"]'),
    // A workspace with no groups offers its link to the Groups view in their place.
    groups: () => groupsRef.current?.querySelector<HTMLElement>('[role="checkbox"], a'),
    credentials: () => revokeRef.current,
    // A member with no display name has no flag to land on, so focus goes to who they are.
    flag: () => flagRef.current ?? titleRef.current,
    removal: () => askRef.current,
  } satisfies Readonly<Record<OpenedAt, () => HTMLElement | null | undefined>>;

  return (
    <RowSheet
      rowButtonId={memberButtonId(member.personId)}
      onOpen={() => {
        (landOn[openedAt]() ?? titleRef.current)?.focus();
      }}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <SheetHeader className="border-b border-border">
        <div className="flex items-center gap-3 pr-8">
          <Avatar aria-hidden className="size-9">
            <AvatarFallback>{initialsOf(member)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col leading-tight">
            <SheetTitle asChild>
              <h2 ref={titleRef} tabIndex={-1} className="wrap-anywhere">
                {nameOf(member)}
              </h2>
            </SheetTitle>
            <SheetDescription className="wrap-anywhere">{member.address}</SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        <Membership member={member} />
        <RolePicker member={member} pickerRef={pickerRef} />
        <GroupsPicker member={member} pickerRef={groupsRef} />
        <CredentialsRevoker member={member} revokeRef={revokeRef} />
        <DisplayNameFlag member={member} flagRef={flagRef} />
        <MemberRemoval member={member} askRef={askRef} onRemove={onRemove} />
      </div>
    </RowSheet>
  );
}
