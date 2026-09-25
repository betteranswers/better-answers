import { useId, useRef, useState, type RefObject } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet.tsx";

import { useChangeRole, type ListedMember, type Role, type RoleChanged } from "./people-api.ts";
import { aRole, ROLE_MEANINGS, ROLES } from "./role-meanings.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { GroupPills, LONG_UK_DATE, nameOf } from "./words.tsx";

/** Where focus lands when the sheet opens: on who the member is, or straight on their role. */
export type OpenedAt = "member" | "role";

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
          <span className="tabular-nums">{LONG_UK_DATE.format(new Date(member.joinedAt))}</span>
        </SummaryRow>
      </dl>
    </section>
  );
}

const roleOf = (value: string): Role | undefined => ROLES.find((role) => role === value);

function RolePicker(properties: {
  readonly member: ListedMember;
  readonly pickerRef: RefObject<HTMLDivElement | null>;
}) {
  const { member, pickerRef } = properties;
  const [draft, setDraft] = useState<Role>(member.role);
  const [outcome, setOutcome] = useState<Outcome>();
  const changeRole = useChangeRole();
  const headingId = useId();
  const hintId = useId();
  const itemId = useId();
  const name = nameOf(member);

  // Focus stays on the picker, since the button it left is disabled once the row takes the role.
  const commit = () => {
    pickerRef.current?.querySelector<HTMLElement>(`[value="${draft}"]`)?.focus();
    setOutcome(undefined);
    changeRole.mutate(
      { personId: member.personId, role: draft },
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

  const unchanged = draft === member.role;

  return (
    <section aria-labelledby={headingId} className="border border-border">
      <h3 id={headingId} className="border-b border-border px-4 py-2 font-medium">
        Role
      </h3>
      <div className="grid gap-4 px-4 py-3">
        <RadioGroup
          ref={pickerRef}
          aria-labelledby={headingId}
          value={draft}
          onValueChange={(value) => {
            setDraft(roleOf(value) ?? draft);
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
            Make {name} {aRole(draft)}
          </Button>
          <p id={hintId} className="text-sm text-muted-foreground">
            {unchanged
              ? `${name} is ${aRole(member.role)}. Pick another role to change it.`
              : "One governed write, audited under your name. It holds from their next request."}
          </p>
        </div>

        <OutcomeLine outcome={outcome} />
      </div>
    </section>
  );
}

/** Block 2 of the external People UI, its plural roles folded to the one role a member holds. */
export function MemberSheet(properties: {
  readonly member: ListedMember;
  readonly openedAt: OpenedAt;
  readonly onClose: () => void;
}) {
  const { member, openedAt, onClose } = properties;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (openedAt === "role") {
            pickerRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
          } else {
            titleRef.current?.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(memberButtonId(member.personId))?.focus();
        }}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
