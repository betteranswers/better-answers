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

export const invitedOutcome = (sent: SentInvitation): Outcome =>
  sent.emailSent
    ? {
        tone: "said",
        words: `Invited ${sent.address} as ${aRole(sent.role)}. The email went, and the invitation lasts until ${longDate(sent.expiresAt)}.`,
      }
    : {
        tone: "refused",
        words: `The invitation to ${sent.address} stands, but its email did not go. Resend it from the Invitations tab.`,
      };

export const resentOutcome = (sent: SentInvitation): Outcome =>
  sent.emailSent
    ? {
        tone: "said",
        words: `Sent the invitation to ${sent.address} again. It lasts until ${longDate(sent.expiresAt)}.`,
      }
    : {
        tone: "refused",
        words: `The invitation to ${sent.address} stands, but its email did not go again. Resend it in a while.`,
      };
