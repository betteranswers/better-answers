import type { Role } from "@/shared/navigation.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import type { Said } from "@/shared/refusal-words.ts";
import { counted, dayWords } from "@/shared/words.ts";

import { EMPTY_LINES } from "./empty-lines.ts";
import type { InvitationStatus, InvitedOne, SentInvitation } from "./invitations-api.ts";
import { aRole } from "./role-meanings.ts";

const invitations = (count: number): string => counted(count, "invitation", "invitations");

/** A failed email is said as loudly as a refusal: the invitation stands, and nobody knows of it. */
const outcomeOfSending = (
  sent: SentInvitation,
  words: { readonly went: string; readonly didNotGo: string },
): Outcome =>
  sent.emailSent ? { tone: "said", words: words.went } : { tone: "refused", words: words.didNotGo };

export const approvedOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `Approved. The invitation went to ${sent.address} as ${aRole(sent.role)} and lasts until ${dayWords(sent.expiresAt)}.`,
    didNotGo: `Approved, but the email to ${sent.address} did not go. The invitation stands: resend it from the Invitations tab.`,
  });

export const resentOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `Sent the invitation to ${sent.address} again. It lasts until ${dayWords(sent.expiresAt)}.`,
    didNotGo: `The invitation to ${sent.address} stands, but its email did not go again. Resend it later; if it keeps failing, the platform's operator can see why.`,
  });

const addressesOf = (sent: readonly SentInvitation[]): string =>
  sent.map((one) => one.address).join(", ");

/** Each email that did not go has a Resend beside the outcome, which this line points at. */
const unsentSaid = (unsent: readonly SentInvitation[]): string =>
  unsent.length === 1
    ? `The email to ${addressesOf(unsent)} did not go, but its invitation stands. Resend it below.`
    : `The emails to ${addressesOf(unsent)} did not go, but their invitations stand. Resend each below.`;

const lastsUntil = (sent: readonly SentInvitation[]): string => {
  const [first] = sent;
  return first === undefined ? "" : dayWords(first.expiresAt);
};

const emailsSaid = (sent: readonly SentInvitation[]): string => {
  const unsent = sent.filter((one) => !one.emailSent);
  if (unsent.length > 0) return unsentSaid(unsent);
  return sent.length === 1
    ? `The email went, and the invitation lasts until ${lastsUntil(sent)}.`
    : `The emails went, and the invitations last until ${lastsUntil(sent)}.`;
};

const ledBy = (invited: readonly InvitedOne[], role: Role): string => {
  const [only] = invited;
  if (invited.length > 1 || only === undefined) {
    return `Invited ${String(invited.length)} people as ${role}s.`;
  }
  return only.replaced
    ? `Re-sent the invitation to ${only.address} as ${aRole(role)}, replacing the one waiting.`
    : `Invited ${only.address} as ${aRole(role)}.`;
};

/** With one address the lead names it; with several, the re-sent ones are named apart. */
const resentSaid = (invited: readonly InvitedOne[]): string => {
  const replaced = invited.filter((one) => one.replaced);
  if (invited.length === 1 || replaced.length === 0) return "";
  return ` Re-sent to ${addressesOf(replaced)}, replacing the ${replaced.length === 1 ? "invitation" : "invitations"} waiting.`;
};

export const invitedOutcome = (invited: readonly InvitedOne[], role: Role): Outcome => {
  const words = `${ledBy(invited, role)}${resentSaid(invited)} ${emailsSaid(invited)}`;
  return invited.every((one) => one.emailSent)
    ? { tone: "said", words }
    : { tone: "refused", words };
};

export const bulkResentOutcome = (resent: readonly SentInvitation[]): Outcome => {
  const lead = `Sent ${invitations(resent.length)} again.`;
  return resent.every((one) => one.emailSent)
    ? {
        tone: "said",
        words: `${lead} ${resent.length === 1 ? "It lasts" : "Each lasts"} until ${lastsUntil(resent)}.`,
      }
    : { tone: "refused", words: `${lead} ${unsentSaid(resent.filter((one) => !one.emailSent))}` };
};

const cancelledSaid = (changed: number, skipped: number): string => {
  const done =
    changed === 0
      ? "Nothing was cancelled"
      : `Cancelled ${invitations(changed)}; ${changed === 1 ? "its link no longer works" : "their links no longer work"}`;
  return skipped === 0
    ? `${done}.`
    : `${done}. ${counted(skipped, "was", "were")} cancelled already.`;
};

export const STATUS_WORDS = {
  waiting: "Waiting",
  accepted: "Accepted",
  expired: "Expired",
  cancelled: "Cancelled",
} as const satisfies Readonly<Record<InvitationStatus, string>>;

/** Apart from `words.tsx` and its JSX, so the browser suite reads the lines the tab shows. */
export const INVITATIONS_WORDS = {
  status: "Status",
  search: "Search by address",
  selected: "Selected invitations",
  everyOnThePage: "Select every invitation on this page",
  pages: "Pages of invitations",
  loading: "The invitations are still loading.",
  caption:
    "Invitations to this workspace, each with its role, the day it was sent and the day it expires. A tick selects a waiting or expired invitation for an act on every invitation selected.",
  noneIn: {
    waiting: EMPTY_LINES.invitations,
    accepted: "No invitation has been accepted yet.",
    expired: "No invitation has expired.",
    cancelled: "No invitation has been cancelled.",
  } satisfies Readonly<Record<InvitationStatus, string>>,
  noneMatch: (search: string) => `No invitation matches “${search}”.`,
  counted: (status: InvitationStatus, total: number) =>
    counted(total, `${status} invitation`, `${status} invitations`),
  matched: (status: InvitationStatus, shown: number, total: number, search: string) =>
    `${String(shown)} of ${counted(total, `${status} invitation`, `${status} invitations`)} match “${search}”.`,
  resend: "Resend",
  cancel: "Cancel",
  noLongerListed: "An invitation no longer listed",
  resending: (address: string) => `Sending the invitation to ${address} again.`,
  cancelled: (address: string) =>
    `Cancelled the invitation to ${address}; its link no longer works.`,
  bulk: {
    resending: (count: number) => `Sending ${invitations(count)} again.`,
    cancelling: (count: number) => `Cancelling ${invitations(count)}.`,
    cancelled: cancelledSaid,
    refused: (count: number) =>
      `Nothing changed. ${counted(count, "invitation was", "invitations were")} refused:`,
    tooMany: (most: number) => `Select at most ${invitations(most)} for one act.`,
  },
  unsent: "Emails that did not go",
  resendTo: (address: string) => `Resend the invitation to ${address}`,
} as const;

/** The dialog's words; its title and its button are the act's own name. */
export const INVITE_WORDS = {
  description:
    "Each gets an email with a link to join, good for seven days. An address with an invitation waiting gets this one in its place.",
  field: "Email addresses",
  hint: "Separate addresses with commas or new lines. Enter adds what you typed.",
  list: "Addresses to invite",
  remove: (address: string) => `Remove ${address}`,
  flag: {
    ready: "Ready",
    malformed: "Not an email address",
    "already-a-member": "A member already",
  },
  summary: (ready: number, flagged: number) =>
    flagged === 0
      ? `${counted(ready, "address", "addresses")} ready.`
      : `${counted(ready, "address", "addresses")} ready, ${String(flagged)} to fix or remove.`,
  send: (count: number) => (count <= 1 ? "Send the invitation" : `Send ${invitations(count)}`),
  sending: (count: number) =>
    count <= 1 ? "Sending the invitation" : `Sending ${invitations(count)}`,
  done: "Done",
} as const;

export const INVITE_REFUSED = {
  flagged: {
    why: "Nothing was sent: an address below is flagged.",
    next: "Fix or remove it, then send again.",
  },
  none: { why: "There is no address to send to.", next: "Type or paste one first." },
  capped: (most: number): Said => ({
    why: `One send holds at most ${String(most)} addresses.`,
    next: "The rest wait in the field: send these first.",
  }),
} as const;
