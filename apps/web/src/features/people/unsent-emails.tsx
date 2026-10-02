import { useId, useState } from "react";

import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { INVITATIONS_WORDS, resentOutcome } from "./invitation-words.ts";
import { useResendInvitation, type SentInvitation } from "./invitations-api.ts";
import { outcomeOfSendingFailure } from "./refusal.tsx";

/** The list stays as each Resend answers, so focus stays on the button pressed. */
export function UnsentEmails(properties: { readonly unsent: readonly SentInvitation[] }) {
  const resend = useResendInvitation();
  // One resend at a time: a second call on the mutation takes over the first's callbacks.
  const [acting, setActing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const headingId = useId();
  if (properties.unsent.length === 0) return null;

  const resent = (invitation: SentInvitation) => {
    if (acting) return;
    setActing(true);
    setOutcome({ tone: "said", words: INVITATIONS_WORDS.resending(invitation.address) });
    resend.mutate(
      { invitationId: invitation.invitationId },
      {
        onSuccess: (sent) => {
          setActing(false);
          setOutcome(resentOutcome(sent));
        },
        onError: (failure) => {
          setActing(false);
          setOutcome(outcomeOfSendingFailure(failure));
        },
      },
    );
  };

  return (
    <section aria-labelledby={headingId} className="grid gap-2 wrap-anywhere">
      <h3 id={headingId} className="text-sm font-medium">
        {INVITATIONS_WORDS.unsent}
      </h3>
      <ul className="grid gap-1">
        {properties.unsent.map((invitation) => (
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
      <OutcomeLine outcome={outcome} className="text-sm" />
    </section>
  );
}
