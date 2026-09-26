import { useId, useRef, useState } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { TableCell } from "@/shared/ui/table.tsx";

import { ApproveRequest } from "./approve-request.tsx";
import { approvedOutcome, longDate } from "./invitation-words.ts";
import type { Role } from "./people-api.ts";
import { PEOPLE_KEYSTROKES, useInviteAsked } from "./people-state.ts";
import { outcomeOfRequestFailure } from "./refusal.tsx";
import {
  requesterName,
  useApproveRequest,
  useDeclineRequest,
  useRequests,
  type WaitingRequest,
} from "./requests-api.ts";
import { aRole } from "./role-meanings.ts";
import { useKeystrokeOnHeld, WaitingRow, WaitingTable } from "./waiting-list.tsx";

const COLUMNS = ["Person", "Reason", "State", "Asked", "Acts"] as const;

const NOTHING_HELD: Outcome = {
  tone: "said",
  words: "Move focus to a request's row first, then press the key again.",
};

const countOf = (requests: readonly WaitingRequest[]): string =>
  requests.length === 1 ? "1 request waiting" : `${requests.length} requests waiting`;

function NobodyAsking() {
  const [, askToInvite] = useInviteAsked();
  return (
    <div className="mt-4 flex flex-col items-start gap-1 border border-border bg-card px-4 py-10">
      <p className="font-medium">Nobody is asking to join.</p>
      <p className="text-muted-foreground">
        A person signed in to no workspace asks to join this one by its slug, with a reason.
      </p>
      <Button
        variant="outline"
        className="mt-3"
        onClick={() => {
          askToInvite(Date.now());
        }}
      >
        Invite a person by address
      </Button>
    </div>
  );
}

function Requester(properties: { readonly request: WaitingRequest }) {
  const { name, email } = properties.request.requester;
  return (
    <span className="flex min-w-0 flex-col items-start leading-tight">
      {name === "" ? (
        <span className="text-muted-foreground">No display name yet</span>
      ) : (
        <span className="font-medium">{name}</span>
      )}
      <span className="text-xs text-muted-foreground wrap-anywhere">{email}</span>
    </span>
  );
}

type RequestActs = {
  readonly onHeld: (request: WaitingRequest | undefined) => void;
  readonly onApprove: (request: WaitingRequest) => void;
  readonly onDecline: (request: WaitingRequest) => void;
};

function RequestRow(properties: {
  readonly request: WaitingRequest;
  readonly acts: RequestActs;
  readonly consequenceId: string;
}) {
  const { request, acts, consequenceId } = properties;
  const name = requesterName(request);

  return (
    <WaitingRow item={request} onHeld={acts.onHeld}>
      <TableCell className="whitespace-normal">
        <Requester request={request} />
      </TableCell>
      <TableCell className="max-w-prose whitespace-normal wrap-anywhere">
        {request.reason}
      </TableCell>
      <TableCell>
        <Pill>Waiting</Pill>
      </TableCell>
      <TableCell className="tabular-nums">{longDate(request.askedAt)}</TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-haspopup="dialog"
            aria-label={`Approve the request from ${name}`}
            aria-describedby={consequenceId}
            aria-keyshortcuts={PEOPLE_KEYSTROKES.approve.key}
            onClick={() => {
              acts.onApprove(request);
            }}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Decline the request from ${name}`}
            aria-describedby={consequenceId}
            aria-keyshortcuts={PEOPLE_KEYSTROKES.decline.key}
            onClick={() => {
              acts.onDecline(request);
            }}
          >
            Decline
          </Button>
        </span>
      </TableCell>
    </WaitingRow>
  );
}

function RequestList(properties: {
  readonly requests: readonly WaitingRequest[];
  readonly onOutcome: (outcome: Outcome) => void;
  readonly onApprove: (request: WaitingRequest) => void;
  readonly onDeclined: () => void;
}) {
  const { requests, onOutcome, onApprove } = properties;
  const [held, setHeld] = useState<WaitingRequest>();
  const decline = useDeclineRequest();
  const consequenceId = useId();

  const declined = (request: WaitingRequest) => {
    setHeld(undefined);
    properties.onDeclined();
    onOutcome({
      tone: "said",
      words: `Declined the request from ${requesterName(request)}. They may ask again.`,
    });
    decline.mutate(
      { requestId: request.id },
      {
        onError: (failure) => {
          onOutcome(outcomeOfRequestFailure(failure));
        },
      },
    );
  };

  const nothingHeld = () => {
    onOutcome(NOTHING_HELD);
  };
  useKeystrokeOnHeld(PEOPLE_KEYSTROKES.approve, held, onApprove, nothingHeld);
  useKeystrokeOnHeld(PEOPLE_KEYSTROKES.decline, held, declined, nothingHeld);

  const acts: RequestActs = { onHeld: setHeld, onApprove, onDecline: declined };

  return (
    <>
      <output className="mt-1 block text-muted-foreground empty:hidden">
        {requests.length === 0 ? null : countOf(requests)}
      </output>
      {requests.length === 0 ? (
        <NobodyAsking />
      ) : (
        <>
          <p id={consequenceId} className="mt-1 text-muted-foreground">
            Approving emails the person an invitation that lasts seven days. Declining sends them
            nothing, and they may ask again.
          </p>
          <WaitingTable
            caption="Requests to join this workspace waiting for an Admin, each with who asked, why and when."
            columns={COLUMNS}
          >
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                acts={acts}
                consequenceId={consequenceId}
              />
            ))}
          </WaitingTable>
        </>
      )}
    </>
  );
}

export function RequestsTab() {
  const requests = useRequests();
  const approve = useApproveRequest();
  const [outcome, setOutcome] = useState<Outcome>();
  const [approving, setApproving] = useState<WaitingRequest>();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const openedFrom = useRef<HTMLElement | null>(null);

  // Read when the dialog opens, by a click or a key, since either leaves focus where the act began.
  const toApprove = (request: WaitingRequest) => {
    const { activeElement } = document;
    openedFrom.current = activeElement instanceof HTMLElement ? activeElement : null;
    setApproving(request);
  };

  /** Where the dialog was opened from, unless the approval went and took that row with it. */
  const focusBack = (sent: boolean) => {
    const from = openedFrom.current;
    (sent || from?.isConnected !== true ? heading.current : from)?.focus();
  };

  const approved = (request: WaitingRequest, role: Role) => {
    setApproving(undefined);
    setOutcome({
      tone: "said",
      words: `Approving the request from ${requesterName(request)} as ${aRole(role)}.`,
    });
    approve.mutate(
      { requestId: request.id, role },
      {
        onSuccess: (invited) => {
          setOutcome(approvedOutcome(invited));
        },
        onError: (failure) => {
          setOutcome(outcomeOfRequestFailure(failure));
        },
      },
    );
  };

  return (
    <section aria-labelledby={headingId} className="mt-6">
      {/* Focusable, so a decided row's focus lands here rather than on the page. */}
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        Requests
      </h2>
      <OutcomeLine
        outcome={requests.error === null ? outcome : outcomeOfRequestFailure(requests.error)}
        className="mt-2"
      />
      <div aria-live="polite">
        {requests.isPending ? <p className="mt-2">The requests are still loading.</p> : null}
      </div>
      {requests.data === undefined ? null : (
        <RequestList
          requests={requests.data}
          onOutcome={setOutcome}
          onApprove={toApprove}
          onDeclined={() => {
            heading.current?.focus();
          }}
        />
      )}
      {approving === undefined ? null : (
        <ApproveRequest
          key={approving.id}
          request={approving}
          onApprove={(role) => {
            approved(approving, role);
          }}
          onClose={() => {
            setApproving(undefined);
          }}
          onFocusBack={focusBack}
        />
      )}
    </section>
  );
}
