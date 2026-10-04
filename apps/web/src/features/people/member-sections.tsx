import { Link } from "@tanstack/react-router";
import { useId, useState, type RefObject } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { EmptyState } from "@/shared/empty-state.tsx";
import { Icon } from "@/shared/icon.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group.tsx";
import { instantWords } from "@/shared/words.ts";

import { EMPTY_LINES } from "./empty-lines.ts";
import { GroupChecklist } from "./group-checklist.tsx";
import { useGroups } from "./groups-api.ts";
import { GroupsReadSaid } from "./groups-read.tsx";
import { INCLUDES_YOU, RECORDED } from "./member-act-words.ts";
import { MemberRemoval } from "./member-removal.tsx";
import { GROUPS_PATH } from "./members-address.ts";
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
import { outcomeOfFailure } from "./refusal.tsx";
import { aRole, ROLE_MEANINGS, roleOf, ROLES } from "./role-meanings.ts";
import { useSelfActHome } from "./self-act.tsx";
import { CredentialsHere, Day, GroupPills, nameOf } from "./words.tsx";

/** The control each of the page's acts lands focus on, so a keystroke can reach any of them. */
export type Landings = {
  readonly role: RefObject<HTMLDivElement | null>;
  readonly groups: RefObject<HTMLDivElement | null>;
  readonly flag: RefObject<HTMLButtonElement | null>;
  readonly credentials: RefObject<HTMLButtonElement | null>;
  readonly removal: RefObject<HTMLButtonElement | null>;
};

/** Removal is the page's to take: the person, and the page with them, leave as it lands. */
export type Removal = {
  /** None until the reader's own membership is read. */
  readonly remove: ((member: ListedMember) => void) | undefined;
  readonly outcome: Outcome | undefined;
};

function AccessSummary(properties: { readonly member: ListedMember }) {
  const { member } = properties;

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
      <SummaryRow term="Role">
        <Pill>{member.role}</Pill>
      </SummaryRow>
      <SummaryRow term="Groups">
        <GroupPills groups={member.groups} />
      </SummaryRow>
      <SummaryRow term="Joined">
        <Day instant={member.joinedAt} />
      </SummaryRow>
      <SummaryRow term="Credentials here">
        <CredentialsHere revokedAt={member.credentialsRevokedAt} />
      </SummaryRow>
    </dl>
  );
}

/** The hint beside the commit, which says so when the act is on the reader themself. */
const roleHint = (name: string, held: Role, unchanged: boolean, yourself: boolean): string => {
  if (unchanged) return `${name} is ${aRole(held)}. Pick another role to change it.`;
  return yourself
    ? `${INCLUDES_YOU} ${RECORDED} It holds from your next request.`
    : `${RECORDED} It holds from their next request.`;
};

function RolePicker(properties: {
  readonly member: ListedMember;
  readonly pickerRef: RefObject<HTMLDivElement | null>;
}) {
  const { member, pickerRef } = properties;
  const [picked, setPicked] = useState<Role>(member.role);
  const [outcome, setOutcome] = useState<Outcome>();
  const changeRole = useChangeRole();
  const yourself = useReaderId() === member.personId;
  const { goHome } = useSelfActHome();
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
          // People is for Admins, so a reader who is one no longer leaves it for their new home.
          if (!yourself || changed.role === "Admin") return;
          void goHome("demoted").then((unread) => {
            if (unread !== undefined) setOutcome(unread);
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
      <h3 id={headingId} className="max-w-none border-b border-border px-4 py-2 font-medium">
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
            {roleHint(name, member.role, unchanged, yourself)}
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
      <GroupsReadSaid error={groups.error} isPending={groups.isPending} />
      <div ref={pickerRef} className="contents">
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

/** Who the member is and what they may reach here, with each act that changes it. */
export function Access(properties: { readonly member: ListedMember; readonly landings: Landings }) {
  const { member, landings } = properties;

  return (
    <>
      <AccessSummary member={member} />
      <RolePicker member={member} pickerRef={landings.role} />
      <GroupsPicker member={member} pickerRef={landings.groups} />
      <DisplayNameFlag member={member} flagRef={landings.flag} />
    </>
  );
}

/** The two acts that end the person's access here, set apart from the rest. */
export function RemoveAndRevoke(properties: {
  readonly member: ListedMember;
  readonly landings: Landings;
  readonly removal: Removal;
}) {
  const { member, landings, removal } = properties;

  return (
    <>
      <CredentialsRevoker member={member} revokeRef={landings.credentials} />
      <MemberRemoval
        member={member}
        askRef={landings.removal}
        onRemove={removal.remove}
        outcome={removal.outcome}
      />
    </>
  );
}
