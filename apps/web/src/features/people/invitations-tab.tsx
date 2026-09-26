import { useId, useRef, useState } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { TableCell } from "@/shared/ui/table.tsx";

import { EMPTY_LINES } from "./empty-lines.ts";
import { resentOutcome } from "./invitation-words.ts";
import {
  useCancelInvitation,
  useInvitations,
  useResendInvitation,
  type WaitingInvitation,
} from "./invitations-api.ts";
import { PEOPLE_KEYSTROKES } from "./people-state.ts";
import { outcomeOfInvitationFailure } from "./refusal.tsx";
import {
  DayCell,
  NothingWaiting,
  useKeystrokeOnHeld,
  WaitingRow,
  WaitingTable,
} from "./waiting-list.tsx";

const COLUMNS = ["Address", "Role", "State", "Sent", "Expires", "Invited by", "Acts"] as const;

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

function InvitationRow(properties: {
  readonly invitation: WaitingInvitation;
  readonly now: number;
  readonly onHeld: (invitation: WaitingInvitation | undefined) => void;
  readonly onResend: (invitation: WaitingInvitation) => void;
  readonly onCancel: (invitation: WaitingInvitation) => void;
}) {
  const { invitation } = properties;
  const expired = hasExpired(invitation, properties.now);

  return (
    <WaitingRow item={invitation} onHeld={properties.onHeld}>
      <TableCell className="whitespace-normal wrap-anywhere">{invitation.address}</TableCell>
      <TableCell>
        <Pill>{invitation.role}</Pill>
      </TableCell>
      <TableCell>
        <Pill>{expired ? "Expired" : "Waiting"}</Pill>
      </TableCell>
      <DayCell instant={invitation.invitedAt} />
      <DayCell instant={invitation.expiresAt} />
      <TableCell>
        {invitation.invitedBy === "" ? (
          <span className="text-muted-foreground">No display name yet</span>
        ) : (
          invitation.invitedBy
        )}
      </TableCell>
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
            Resend
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
    </WaitingRow>
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

  const nothingHeld = () => {
    onOutcome(NOTHING_HELD);
  };
  useKeystrokeOnHeld(PEOPLE_KEYSTROKES.resend, held, resent, nothingHeld);
  useKeystrokeOnHeld(PEOPLE_KEYSTROKES.cancel, held, cancelled, nothingHeld);

  return (
    <>
      <output className="mt-1 block text-muted-foreground empty:hidden">
        {invitations.length === 0 ? null : countOf(invitations, now)}
      </output>
      {invitations.length === 0 ? (
        <NothingWaiting line={EMPTY_LINES.invitations} />
      ) : (
        <WaitingTable
          caption="Invitations to this workspace not yet accepted, each with its role, state and expiry."
          columns={COLUMNS}
        >
          {invitations.map((invitation) => (
            <InvitationRow
              key={invitation.invitationId}
              invitation={invitation}
              now={now}
              onHeld={setHeld}
              onResend={resent}
              onCancel={cancelled}
            />
          ))}
        </WaitingTable>
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
