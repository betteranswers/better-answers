import { useId, useRef, useState, type RefObject } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { RowSheet } from "@/shared/row-sheet.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group.tsx";
import { SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet.tsx";
import { instantWords } from "@/shared/words.ts";

import {
  useChangeRole,
  useReaderId,
  useRevokeCredentials,
  type CredentialsRevokedHere,
  type ListedMember,
  type Role,
  type RoleChanged,
} from "./people-api.ts";
import { aRole, ROLE_MEANINGS, roleOf, ROLES } from "./role-meanings.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { CredentialsHere, GroupPills, JoinedOn, nameOf } from "./words.tsx";

/** Where focus lands when the sheet opens: on who the member is, or straight on an act. */
export type OpenedAt = "member" | "role" | "credentials";

export const memberButtonId = (personId: string): string => `member-${personId}`;

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
              : "Recorded on the audit log under your name. It holds from their next request."}
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
  const headingId = useId();
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
    <section aria-labelledby={headingId} className="border border-border">
      <h3 id={headingId} className="border-b border-border px-4 py-2 font-medium">
        Credentials
      </h3>
      <div className="grid gap-4 px-4 py-3">
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
            {member.personId === readerId
              ? "Your own session here ends with it."
              : "Recorded on the audit log under your name."}
          </p>
        </div>

        <OutcomeLine outcome={outcome} />
      </div>
    </section>
  );
}

export function MemberSheet(properties: {
  readonly member: ListedMember;
  readonly openedAt: OpenedAt;
  readonly onClose: () => void;
}) {
  const { member, openedAt, onClose } = properties;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);

  return (
    <RowSheet
      rowButtonId={memberButtonId(member.personId)}
      onOpen={() => {
        if (openedAt === "role") {
          pickerRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
        } else if (openedAt === "credentials") {
          revokeRef.current?.focus();
        } else {
          titleRef.current?.focus();
        }
      }}
      onClose={onClose}
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
        <CredentialsRevoker member={member} revokeRef={revokeRef} />
      </div>
    </RowSheet>
  );
}
