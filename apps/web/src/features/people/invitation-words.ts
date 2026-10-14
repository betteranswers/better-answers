import type { Role } from "@/shared/navigation.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { counted, dayWords } from "@/shared/words.ts";

import { EMPTY_LINES } from "./empty-lines.ts";
import type { InvitationStatus, InvitedOne, SentInvitation } from "./invitations-api.ts";
import { aRole } from "./role-meanings.ts";

const invitations = (count: number): string => counted(count, "invitation", "invitations");

const invitationsIn = (status: InvitationStatus, count: number): string =>
  counted(count, `${status} invitation`, `${status} invitations`);

/** A failed email is said as loudly as a refusal: the invitation stands, and nobody knows of it. */
const outcomeOfSending = (
  sent: SentInvitation,
  words: { readonly went: string; readonly didNotGo: string },
): Outcome =>
  sent.emailSent ? { tone: "said", words: words.went } : { tone: "refused", words: words.didNotGo };

export const approvedOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `The request has been approved successfully. An invitation was sent to ${sent.address} as ${aRole(sent.role)} and expires on ${dayWords(sent.expiresAt)}.`,
    didNotGo: `The request was approved, but the email to ${sent.address} could not be sent. The invitation is still valid. Please resend it from the Invitations tab.`,
  });

export const resentOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `The invitation to ${sent.address} has been resent successfully. It expires on ${dayWords(sent.expiresAt)}.`,
    didNotGo: `The email to ${sent.address} could not be sent, but the invitation is still valid. Please try again later, or contact better-answers support if the problem continues.`,
  });

const addressesOf = (sent: readonly SentInvitation[]): string =>
  sent.map((one) => one.address).join(", ");

/** Each email that did not go has a Resend beside the outcome, which this line points at. */
const unsentSaid = (unsent: readonly SentInvitation[]): string =>
  unsent.length === 1
    ? `The email to ${addressesOf(unsent)} could not be sent, but the invitation is still valid. Please resend it below.`
    : `The emails to ${addressesOf(unsent)} could not be sent, but the invitations are still valid. Please resend each one below.`;

const lastsUntil = (sent: readonly SentInvitation[]): string => {
  const [first] = sent;
  return first === undefined ? "" : dayWords(first.expiresAt);
};

const emailsSaid = (sent: readonly SentInvitation[]): string => {
  const unsent = sent.filter((one) => !one.emailSent);
  if (unsent.length > 0) return unsentSaid(unsent);
  return sent.length === 1
    ? `The email was sent successfully, and the invitation expires on ${lastsUntil(sent)}.`
    : `The emails were sent successfully, and the invitations expire on ${lastsUntil(sent)}.`;
};

const ledBy = (invited: readonly InvitedOne[], role: Role): string => {
  const [only] = invited;
  if (invited.length > 1 || only === undefined) {
    return `${String(invited.length)} people have been invited as ${role}s.`;
  }
  return only.replaced
    ? `The invitation to ${only.address} has been resent as ${aRole(role)}, replacing the one that was waiting.`
    : `${only.address} has been invited as ${aRole(role)}.`;
};

/** With one address the lead names it; with several, the re-sent ones are named apart. */
const resentSaid = (invited: readonly InvitedOne[]): string => {
  const replaced = invited.filter((one) => one.replaced);
  if (invited.length === 1 || replaced.length === 0) return "";
  return replaced.length === 1
    ? ` The invitation to ${addressesOf(replaced)} replaced the one that was waiting.`
    : ` The invitations to ${addressesOf(replaced)} replaced the ones that were waiting.`;
};

export const invitedOutcome = (invited: readonly InvitedOne[], role: Role): Outcome => {
  const words = `${ledBy(invited, role)}${resentSaid(invited)} ${emailsSaid(invited)}`;
  return invited.every((one) => one.emailSent)
    ? { tone: "said", words }
    : { tone: "refused", words };
};

export const bulkResentOutcome = (resent: readonly SentInvitation[]): Outcome => {
  const lead = `${counted(resent.length, "invitation has", "invitations have")} been resent`;
  return resent.every((one) => one.emailSent)
    ? {
        tone: "said",
        words: `${lead} successfully. ${resent.length === 1 ? "It expires" : "Each expires"} on ${lastsUntil(resent)}.`,
      }
    : { tone: "refused", words: `${lead}. ${unsentSaid(resent.filter((one) => !one.emailSent))}` };
};

const cancelledSaid = (changed: number, skipped: number): string => {
  const done =
    changed === 0
      ? "No invitations were cancelled"
      : `${counted(changed, "invitation has", "invitations have")} been cancelled successfully. ${changed === 1 ? "Its link no longer works" : "Their links no longer work"}`;
  return skipped === 0
    ? `${done}.`
    : `${done}. ${counted(skipped, "invitation was", "invitations were")} already cancelled.`;
};

export const STATUS_WORDS = {
  waiting: "Waiting",
  accepted: "Accepted",
  expired: "Expired",
  cancelled: "Cancelled",
} as const satisfies Readonly<Record<InvitationStatus, string>>;

export const INVITATIONS_WORDS = {
  status: "Status",
  search: "Search by address",
  selected: "Selected Invitations",
  everyOnThePage: "Select every invitation on this page",
  pages: "Pages of Invitations",
  loading: "The invitations are still loading.",
  caption: "Invitations to this workspace.",
  noneIn: {
    waiting: EMPTY_LINES.invitations,
    accepted: "No accepted invitations yet",
    expired: "No expired invitations",
    cancelled: "No cancelled invitations",
  } satisfies Readonly<Record<InvitationStatus, string>>,
  noneMatch: (search: string) => `No results found for “${search}”.`,
  counted: invitationsIn,
  matched: (status: InvitationStatus, shown: number, total: number, search: string) =>
    `${String(shown)} of ${invitationsIn(status, total)} match “${search}”.`,
  resend: "Resend",
  cancel: "Cancel",
  noLongerListed: "An invitation no longer listed",
  resending: (address: string) => `Resending the invitation to ${address}.`,
  cancelled: (address: string) =>
    `The invitation to ${address} has been cancelled. Its link no longer works.`,
  bulk: {
    resending: (count: number) => `Resending ${invitations(count)}.`,
    cancelling: (count: number) => `Cancelling ${invitations(count)}.`,
    cancelled: cancelledSaid,
    refused: (count: number) =>
      `No changes were made. There was a problem with ${invitations(count)}:`,
    tooMany: (most: number) => `You can select up to ${invitations(most)} at a time.`,
  },
  unsent: "Unsent Emails",
  resendTo: (address: string) => `Resend Invitation to ${address}`,
} as const;

/** The dialog's words; its title and its button are the action's own name. */
export const INVITE_WORDS = {
  description: "Invite people to your workspace with a specific role.",
  field: "Email Addresses",
  hint: "Separate addresses with commas or new lines.",
  list: "Addresses to Invite",
  remove: (address: string) => `Remove ${address}`,
  flag: {
    ready: "Ready",
    malformed: "Invalid email address",
    "already-a-member": "Already a member",
  },
  summary: (ready: number, flagged: number) =>
    flagged === 0
      ? `${counted(ready, "address", "addresses")} ready.`
      : `${counted(ready, "address", "addresses")} ready, ${String(flagged)} to fix or remove.`,
  send: (count: number) => (count <= 1 ? "Send Invitation" : `Send ${String(count)} Invitations`),
  sending: (count: number) =>
    count <= 1 ? "Sending Invitation" : `Sending ${String(count)} Invitations`,
  waiting: (count: number) =>
    count === 1
      ? "1 more address is waiting. Please invite it next."
      : `${String(count)} more addresses are waiting. Please invite them next.`,
  done: "Done",
} as const;

export const INVITE_REFUSED = {
  flagged: "Please fix or remove the flagged addresses.",
  none: "Please enter at least one email address.",
  capped: (most: number): string => `You can send up to ${String(most)} addresses at a time.`,
} as const;
