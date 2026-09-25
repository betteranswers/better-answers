import { useId, useRef, useState, type FocusEvent } from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table.tsx";

import { longDate, resentOutcome } from "./invitation-words.ts";
import {
  useCancelInvitation,
  useInvitations,
  useResendInvitation,
  type WaitingInvitation,
} from "./invitations-api.ts";
import { PEOPLE_KEYSTROKES } from "./people-state.ts";
import { outcomeOfInvitationFailure } from "./refusal.tsx";

const COLUMNS = ["Address", "Role", "State", "Expires", "Acts"] as const;

const NOTHING_HELD: Outcome = {
  tone: "said",
  words: "Move focus to an invitation's row first, then press the key again.",
};

const hasExpired = (invitation: WaitingInvitation, now: number): boolean =>
  Date.parse(invitation.expiresAt) <= now;

const countOf = (invitations: readonly WaitingInvitation[], now: number): string => {
  const said = invitations.length === 1 ? "1 invitation" : `${invitations.length} invitations`;
  const expired = invitations.filter((invitation) => hasExpired(invitation, now)).length;
  return expired === 0 ? said : `${said}, ${expired} expired`;
};

function NobodyWaiting() {
  return (
    <div className="mt-4 flex flex-col items-start gap-1 border border-border bg-card px-4 py-10">
      <p className="font-medium">Nobody is waiting to join.</p>
      <p className="text-muted-foreground">
        Invite a person by email address with Invite a person above, or press{" "}
        <kbd className="border border-border bg-muted px-1.5 font-mono">
          {PEOPLE_KEYSTROKES.invite.key}
        </kbd>
        . An invitation lasts seven days.
      </p>
    </div>
  );
}

function InvitationRow(properties: {
  readonly invitation: WaitingInvitation;
  readonly now: number;
  readonly resending: boolean;
  readonly onHeld: (invitation: WaitingInvitation | undefined) => void;
  readonly onResend: (invitation: WaitingInvitation) => void;
  readonly onCancel: (invitation: WaitingInvitation) => void;
}) {
  const { invitation } = properties;
  const expired = hasExpired(invitation, properties.now);

  const leaving = (event: FocusEvent<HTMLTableRowElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    properties.onHeld(undefined);
  };

  return (
    <TableRow
      className="border-border"
      onFocus={() => {
        properties.onHeld(invitation);
      }}
      onBlur={leaving}
    >
      <TableCell className="whitespace-normal wrap-anywhere">{invitation.address}</TableCell>
      <TableCell>
        <Pill>{invitation.role}</Pill>
      </TableCell>
      <TableCell>
        <Pill>{expired ? "Expired" : "Waiting"}</Pill>
      </TableCell>
      <TableCell className="tabular-nums">{longDate(invitation.expiresAt)}</TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label={`Resend the invitation to ${invitation.address}`}
            aria-keyshortcuts={PEOPLE_KEYSTROKES.resend.key}
            onClick={() => {
              properties.onResend(invitation);
            }}
          >
            {properties.resending ? "Resending" : "Resend"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Cancel the invitation to ${invitation.address}`}
            aria-keyshortcuts={PEOPLE_KEYSTROKES.cancel.key}
            onClick={() => {
              properties.onCancel(invitation);
            }}
          >
            Cancel
          </Button>
        </span>
      </TableCell>
    </TableRow>
  );
}

function InvitationList(properties: {
  readonly invitations: readonly WaitingInvitation[];
  readonly onOutcome: (outcome: Outcome) => void;
  readonly onCancelled: () => void;
}) {
  const { invitations, onOutcome } = properties;
  // Read once, so the list does not change its mind between renders.
  const [now] = useState(Date.now);
  const [held, setHeld] = useState<WaitingInvitation>();
  const resend = useResendInvitation();
  const cancel = useCancelInvitation();

  // Never disabled while sending: a disabled button drops the focus the keystrokes read.
  const resent = (invitation: WaitingInvitation) => {
    if (resend.isPending) return;
    onOutcome({ tone: "said", words: `Sending the invitation to ${invitation.address} again.` });
    resend.mutate(
      { invitationId: invitation.invitationId },
      {
        onSuccess: (sent) => {
          onOutcome(resentOutcome(sent));
        },
        onError: (failure) => {
          onOutcome(outcomeOfInvitationFailure(failure));
        },
      },
    );
  };

  const cancelled = (invitation: WaitingInvitation) => {
    setHeld(undefined);
    properties.onCancelled();
    onOutcome({
      tone: "said",
      words: `Cancelled the invitation to ${invitation.address}; its link no longer works.`,
    });
    cancel.mutate(
      { invitationId: invitation.invitationId },
      {
        onError: (failure) => {
          onOutcome(outcomeOfInvitationFailure(failure));
        },
      },
    );
  };

  useKeystroke(PEOPLE_KEYSTROKES.resend, () => {
    if (held === undefined) onOutcome(NOTHING_HELD);
    else resent(held);
  });
  useKeystroke(PEOPLE_KEYSTROKES.cancel, () => {
    if (held === undefined) onOutcome(NOTHING_HELD);
    else cancelled(held);
  });

  return (
    <>
      <output className="mt-1 block text-muted-foreground">
        {invitations.length === 0 ? "No invitation is waiting." : countOf(invitations, now)}
      </output>
      {invitations.length === 0 ? (
        <NobodyWaiting />
      ) : (
        <div className="mt-4 border border-border bg-card">
          <Table>
            <TableCaption className="sr-only">
              Invitations to this workspace not yet accepted, each with its role, state and expiry.
            </TableCaption>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                {COLUMNS.map((name) => (
                  <TableHead key={name} scope="col">
                    {name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.invitationId}
                  invitation={invitation}
                  now={now}
                  resending={
                    resend.isPending && resend.variables.invitationId === invitation.invitationId
                  }
                  onHeld={setHeld}
                  onResend={resent}
                  onCancel={cancelled}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

export function InvitationsTab() {
  const invitations = useInvitations();
  const [outcome, setOutcome] = useState<Outcome>();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      {/* Focusable, so a cancelled row's focus lands here rather than on the page. */}
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        Invitations
      </h2>
      <OutcomeLine
        outcome={
          invitations.error === null ? outcome : outcomeOfInvitationFailure(invitations.error)
        }
        className="mt-2"
      />
      <div aria-live="polite">
        {invitations.isPending ? <p className="mt-2">The invitations are still loading.</p> : null}
      </div>
      {invitations.data === undefined ? null : (
        <InvitationList
          invitations={invitations.data}
          onOutcome={setOutcome}
          onCancelled={() => {
            heading.current?.focus();
          }}
        />
      )}
    </section>
  );
}
