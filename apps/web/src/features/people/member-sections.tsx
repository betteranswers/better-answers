import { Link } from "@tanstack/react-router";
import { useId, useState, type RefObject } from "react";

import { Address } from "@/shared/address.tsx";
import type { ApiError } from "@/shared/api/trpc.ts";
import { EmptyState } from "@/shared/empty-state.tsx";
import { Icon } from "@/shared/icon.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "@/shared/ui/card.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group.tsx";

import { EMPTY_LINES } from "./empty-lines.ts";
import { GroupChecklist } from "./group-checklist.tsx";
import { useGroups } from "./groups-api.ts";
import { GroupsReadSaid } from "./groups-read.tsx";
import { MEMBER_PAGE_WORDS as WORDS } from "./member-action-words.ts";
import { MemberRemoval } from "./member-removal.tsx";
import { GROUPS_PATH } from "./members-address.ts";
import {
  useChangeRole,
  useFlagDisplayName,
  useReaderId,
  useEndEverySignInAndToken,
  type ListedMember,
  type Role,
  type RoleChanged,
} from "./people-api.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { ROLE_MEANINGS, roleOf, ROLES } from "./role-meanings.ts";
import { useSelfActionHome } from "./self-action.tsx";
import { CredentialsHere, Day, nameOf } from "./words.tsx";

export type Landings = {
  readonly role: RefObject<HTMLDivElement | null>;
  readonly groups: RefObject<HTMLDivElement | null>;
  readonly flag: RefObject<HTMLButtonElement | null>;
  readonly credentials: RefObject<HTMLButtonElement | null>;
  readonly removal: RefObject<HTMLButtonElement | null>;
};

export type Removal = {
  readonly remove: ((member: ListedMember) => void) | undefined;
  readonly outcome: Outcome | undefined;
};

function AccessSummary(properties: { readonly member: ListedMember }) {
  const { member } = properties;

  return (
    <dl className="grid grid-cols-[fit-content(60%)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      <SummaryRow term="Joined">
        <Day instant={member.joinedAt} />
      </SummaryRow>
      <SummaryRow term={WORDS.signInsAndTokensHere}>
        <CredentialsHere revokedAt={member.credentialsRevokedAt} />
      </SummaryRow>
    </dl>
  );
}

const roleHint = (name: string, held: Role, picked: Role, yourself: boolean): string => {
  if (picked === held) return WORDS.holdsRole(name, held);
  const heldNow = WORDS.heldUntilChanged(name, held);
  const change = yourself ? WORDS.changesYourRole(picked) : WORDS.changesTheirRole(picked);
  return `${heldNow} ${change}`;
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
  const { goHome } = useSelfActionHome();
  const headingId = useId();
  const hintId = useId();
  const itemId = useId();
  const name = nameOf(member);

  const commit = () => {
    pickerRef.current?.querySelector<HTMLElement>(`[value="${picked}"]`)?.focus();
    setOutcome(undefined);
    changeRole.mutate(
      { personId: member.personId, role: picked },
      {
        onSuccess: (changed: RoleChanged) => {
          setOutcome({ tone: "said", words: WORDS.roleChanged(name, changed.role) });
          if (!yourself || changed.role === "Admin") return;
          void goHome("demoted").then((unread) => {
            if (unread !== undefined) setOutcome(unread);
          });
        },
        onError: (failure: Error | ApiError) => {
          setOutcome(outcomeOfFailure(failure, "action"));
        },
      },
    );
  };

  const unchanged = picked === member.role;

  return (
    <Card asChild>
      <section aria-labelledby={headingId}>
        <CardHeader className="border-b py-2">
          <CardTitle asChild className="max-w-none font-medium">
            <h3 id={headingId}>Role</h3>
          </CardTitle>
        </CardHeader>
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
              {WORDS.changeRole}
            </Button>
            <p id={hintId} className="text-sm text-muted-foreground">
              {roleHint(name, member.role, picked, yourself)}
            </p>
          </div>

          <OutcomeLine outcome={outcome} className="contents" />
        </div>
      </section>
    </Card>
  );
}

function CredentialsRevoker(properties: {
  readonly member: ListedMember;
  readonly revokeRef: RefObject<HTMLButtonElement | null>;
}) {
  const { member, revokeRef } = properties;
  const [outcome, setOutcome] = useState<Outcome>();
  const revoke = useEndEverySignInAndToken();
  const readerId = useReaderId();
  const hintId = useId();
  const name = nameOf(member);

  const commit = () => {
    if (revoke.isPending) return;
    setOutcome(undefined);
    revoke.mutate(
      { personId: member.personId },
      {
        onSuccess: () => {
          setOutcome({
            tone: "said",
            words: WORDS.everySignInEnded(name),
          });
        },
        onError: (failure: Error | ApiError) => {
          setOutcome(outcomeOfFailure(failure, "action"));
        },
      },
    );
  };

  return (
    <SheetPart title={WORDS.signInsAndTokens}>
      <div className="flex flex-col items-start gap-2">
        <Button
          ref={revokeRef}
          variant="outline"
          aria-describedby={hintId}
          aria-disabled={revoke.isPending}
          onClick={commit}
        >
          {WORDS.endEverySignInAndToken}
        </Button>
        <p id={hintId} className="text-sm text-muted-foreground">
          {WORDS.endsAtOnce(name)}
          {member.personId === readerId ? " Your own session here will end too." : null}
        </p>
      </div>

      <OutcomeLine outcome={outcome} className="contents" />
    </SheetPart>
  );
}

const SENT_TO_THE_OPERATOR: Outcome = {
  tone: "said",
  words: "The name has been flagged to better-answers support.",
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
          setOutcome(outcomeOfFailure(failure, "action"));
        },
      },
    );
  };

  return (
    <SheetPart title="Display Name">
      {member.displayName === "" ? (
        <p className="min-w-0 text-sm text-muted-foreground">
          <Address address={member.address} /> has not set a display name yet.
        </p>
      ) : (
        <>
          <p className="text-sm">
            People set their own display name. Flag a name that is inappropriate.
          </p>
          <div className="flex flex-col items-start gap-2">
            <Button ref={flagRef} variant="outline" aria-describedby={hintId} onClick={flag}>
              <Icon name="flag" />
              Flag Name
            </Button>
            <p id={hintId} className="text-sm text-muted-foreground">
              This will email better-answers support to correct it. A name already flagged is not
              flagged again.
            </p>
          </div>
          <OutcomeLine outcome={outcome} className="contents" />
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
                Go to Groups
              </Link>
            }
          />
        ) : null}
        {workspaceGroups.length === 0 ? null : (
          <GroupChecklist
            legend={`Groups for ${name}`}
            hint="Changes are saved immediately."
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

export function RemoveAndEndEverySignIn(properties: {
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
