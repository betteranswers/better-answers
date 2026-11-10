import type { Role } from "@/shared/navigation.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { counted, dayWords } from "@/shared/words.ts";

import { EMPTY_LINES } from "./empty-lines.ts";
import type {
  InvitationStatus,
  InvitedOne,
  SentInvitation,
} from "./invitations/invitations-api.ts";
import { aRole } from "./role-meanings.ts";

const invitations = (count: number): string => counted(count, "invitation", "invitations");

const invitationsIn = (status: InvitationStatus, count: number): string =>
  counted(count, `${status} invitation`, `${status} invitations`);

const outcomeOfSending = (
  sent: SentInvitation,
  words: { readonly went: string; readonly didNotGo: string },
): Outcome =>
  sent.emailSent ? { tone: "said", words: words.went } : { tone: "refused", words: words.didNotGo };

export const approvedOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `${sent.address} invited as ${aRole(sent.role)}. The invitation expires on ${dayWords(sent.expiresAt)}.`,
    didNotGo: `Request approved, but the email to ${sent.address} wasn’t sent. Resend it from the Invitations tab.`,
  });

export const resentOutcome = (sent: SentInvitation): Outcome =>
  outcomeOfSending(sent, {
    went: `Invitation to ${sent.address} resent. It expires on ${dayWords(sent.expiresAt)}.`,
    didNotGo: `The email to ${sent.address} wasn’t sent. Try again later, or contact better-answers support.`,
  });

const addressesOf = (sent: readonly SentInvitation[]): string =>
  sent.map((one) => one.address).join(", ");

const unsentSaid = (unsent: readonly SentInvitation[]): string =>
  unsent.length === 1
    ? `email to ${addressesOf(unsent)} wasn’t sent. Resend it below.`
    : `emails to ${addressesOf(unsent)} weren’t sent. Resend them below.`;

const lastsUntil = (sent: readonly SentInvitation[]): string => {
  const [first] = sent;
  return first === undefined ? "" : dayWords(first.expiresAt);
};

const ledBy = (invited: readonly InvitedOne[], role: Role): string => {
  const [only] = invited;
  if (invited.length > 1 || only === undefined) {
    return `${String(invited.length)} people invited as ${role}s`;
  }
  return only.replaced
    ? `Invitation to ${only.address} resent as ${aRole(role)}`
    : `${only.address} invited as ${aRole(role)}`;
};

export const invitedOutcome = (invited: readonly InvitedOne[], role: Role): Outcome => {
  const lead = ledBy(invited, role);
  const unsent = invited.filter((one) => !one.emailSent);
  if (unsent.length === 0) {
    const expires = invited.length === 1 ? "The invitation expires" : "The invitations expire";
    return { tone: "said", words: `${lead}. ${expires} on ${lastsUntil(invited)}.` };
  }
  const notSent =
    invited.length === 1 ? "the email wasn’t sent. Resend it below." : `the ${unsentSaid(unsent)}`;
  return { tone: "refused", words: `${lead}, but ${notSent}` };
};

export const bulkResentOutcome = (resent: readonly SentInvitation[]): Outcome => {
  const went = resent.filter((one) => one.emailSent);
  const unsent = resent.filter((one) => !one.emailSent);
  const lead = `${invitations(went.length)} resent`;
  if (unsent.length === 0) {
    const expires = went.length === 1 ? "It expires" : "Each expires";
    return { tone: "said", words: `${lead}. ${expires} on ${lastsUntil(went)}.` };
  }
  if (went.length === 0) return { tone: "refused", words: `The ${unsentSaid(unsent)}` };
  return { tone: "refused", words: `${lead}, but the ${unsentSaid(unsent)}` };
};

const cancelledSaid = (changed: number, skipped: number): string => {
  const done =
    changed === 0
      ? "No invitations cancelled"
      : `${counted(changed, "invitation", "invitations")} cancelled`;
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
  invitedBy: "Invited by",
  search: "Search by address",
  selected: "Selected invitations",
  everyOnThePage: "Select every invitation on this page",
  pages: "Pages of invitations",
  loading: "Loading invitations…",
  caption: "Invitations to this workspace.",
  noneIn: {
    waiting: EMPTY_LINES.invitations,
    accepted: "No accepted invitations yet",
    expired: "No expired invitations",
    cancelled: "No cancelled invitations",
  } satisfies Readonly<Record<InvitationStatus, string>>,
  noneMatch: (search: string) => `No invitations match “${search}”.`,
  counted: invitationsIn,
  matched: (status: InvitationStatus, shown: number, total: number, search: string) =>
    `${String(shown)} of ${invitationsIn(status, total)} match “${search}”.`,
  resend: "Resend",
  cancel: "Cancel",
  noLongerListed: "An invitation no longer listed",
  resending: (address: string) => `Resending the invitation to ${address}.`,
  cancelled: (address: string) => `Invitation to ${address} cancelled.`,
  bulk: {
    resending: (count: number) => `Resending ${invitations(count)}.`,
    cancelling: (count: number) => `Cancelling ${invitations(count)}.`,
    cancelled: cancelledSaid,
    refused: (count: number) =>
      `No changes were made. There was a problem with ${invitations(count)}:`,
    tooMany: (most: number) => `You can select up to ${invitations(most)} at a time.`,
  },
  unsent: "Unsent emails",
  resendTo: (address: string) => `Resend invitation to ${address}`,
} as const;

export const INVITE_WORDS = {
  description: "Invite people by email and choose their role.",
  field: "Email addresses",
  hint: "Separate addresses with commas or new lines.",
  list: "Addresses to invite",
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
  send: (count: number) => (count <= 1 ? "Send invitation" : `Send ${String(count)} invitations`),
  sending: (count: number) =>
    count <= 1 ? "Sending invitation" : `Sending ${String(count)} invitations`,
  waiting: (count: number) =>
    count === 1
      ? "1 more address is waiting. Invite it next."
      : `${String(count)} more addresses are waiting. Invite them next.`,
  done: "Done",
} as const;

export const REQUEST_WORDS = {
  approving: (name: string, role: string): string =>
    `Approving the request from ${name} as ${role}.`,
  declined: (name: string): string => `Request from ${name} declined.`,
  approveFrom: (name: string): string => `Approve request from ${name}`,
  declineFrom: (name: string): string => `Decline request from ${name}`,
  approveConsequence: (address: string): string =>
    `Send ${address} an invitation with the role below.`,
} as const;

export const INVITE_REFUSED = {
  flagged: "Fix or remove the flagged addresses.",
  none: "Enter at least one email address.",
  capped: (most: number): string => `You can send up to ${String(most)} addresses at a time.`,
  heldBack: (count: number): string =>
    `No invitations were sent. There was a problem with ${counted(count, "address", "addresses")}:`,
} as const;
