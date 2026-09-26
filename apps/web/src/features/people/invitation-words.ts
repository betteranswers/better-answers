import type { Outcome } from "@/shared/outcome.tsx";

import type { SentInvitation } from "./invitations-api.ts";
import { aRole } from "./role-meanings.ts";

const LONG_UK_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

export const longDate = (instant: string): string => LONG_UK_DATE.format(new Date(instant));

/** A failed email is said as loudly as a refusal: the invitation stands, and nobody knows of it. */
const outcomeOfSending = (
  sent: SentInvitation,
  words: { readonly went: string; readonly didNotGo: string },
): Outcome =>
  sent.emailSent ? { tone: "said", words: words.went } : { tone: "refused", words: words.didNotGo };

export const invitedOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `Invited ${sent.address} as ${aRole(sent.role)}. The email went, and the invitation lasts until ${longDate(sent.expiresAt)}.`,
    didNotGo: `The invitation to ${sent.address} stands, but its email did not go. Resend it from the Invitations tab.`,
  });

export const approvedOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `Approved. The invitation went to ${sent.address} as ${aRole(sent.role)} and lasts until ${longDate(sent.expiresAt)}.`,
    didNotGo: `Approved, but the email to ${sent.address} did not go. The invitation stands: resend it from the Invitations tab.`,
  });

export const resentOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `Sent the invitation to ${sent.address} again. It lasts until ${longDate(sent.expiresAt)}.`,
    didNotGo: `The invitation to ${sent.address} stands, but its email did not go again. Resend it later; if it keeps failing, the platform's operator can see why.`,
  });
