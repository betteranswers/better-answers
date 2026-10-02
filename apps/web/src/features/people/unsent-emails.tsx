import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { useOneAtATime } from "./invitation-acts.tsx";
import { INVITATIONS_WORDS, resentOutcome } from "./invitation-words.ts";
import { useResendInvitation, type SentInvitation } from "./invitations-api.ts";
import { outcomeOfSendingFailure } from "./refusal.tsx";

const NONE_WENT: ReadonlySet<SentInvitation> = new Set();

/** A Resend whose email goes takes its row, and focus goes to the heading; one that fails stays. */
export function UnsentEmails(properties: { readonly unsent: readonly SentInvitation[] }) {
  const [outcome, setOutcome] = useState<Outcome>();
  // The rows themselves, not their ids: a later act's answer brings fresh rows, shown whole.
  const [went, setWent] = useState(NONE_WENT);
  const { acting, begin, settled } = useOneAtATime(setOutcome);
  const resend = useResendInvitation();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  // Kept once its last row goes, so the outcome's live region stays to say so.
  if (properties.unsent.length === 0) return null;
  const left = properties.unsent.filter((invitation) => !went.has(invitation));

  const gone = (invitation: SentInvitation) => {
    flushSync(() => {
      setWent((before) => new Set([...before, invitation]));
    });
    heading.current?.focus();
  };

  const resent = (invitation: SentInvitation) => {
    if (!begin()) return;
    setOutcome({ tone: "said", words: INVITATIONS_WORDS.resending(invitation.address) });
    resend.mutate(
      { invitationId: invitation.invitationId },
      settled<SentInvitation>(
        (sent) => {
          setOutcome(resentOutcome(sent));
          if (sent.emailSent) gone(invitation);
        },
        (failure) => {
          setOutcome(outcomeOfSendingFailure(failure));
        },
      ),
    );
  };

  return (
    <section aria-labelledby={headingId} className="grid gap-2 wrap-anywhere">
      <h3 id={headingId} ref={heading} tabIndex={-1} className="text-sm font-medium">
        {INVITATIONS_WORDS.unsent}
      </h3>
      {left.length > 0 && (
        <ul className="grid gap-1">
          {left.map((invitation) => (
            <li key={invitation.invitationId} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">{invitation.address}</span>
              <Button
                size="sm"
                variant="outline"
                aria-label={INVITATIONS_WORDS.resendTo(invitation.address)}
                aria-disabled={acting}
                className="aria-disabled:opacity-50"
                onClick={() => {
                  resent(invitation);
                }}
              >
                {INVITATIONS_WORDS.resend}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <OutcomeLine outcome={outcome} className="text-sm" />
    </section>
  );
}
