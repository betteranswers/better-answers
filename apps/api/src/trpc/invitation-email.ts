import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";
import type { InvitationToSend } from "@better-answers/core/members";

import type { EmailMessage, EmailSender } from "../auth/index.ts";

/** The SPA's accept page, which the link in the email opens with the invitation's id after it. */
const ACCEPT_INVITATION_PATH = "/invitations";

const LONG_UK_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

const ROLE_WITH_ARTICLE = {
  Admin: "an Admin",
  Editor: "an Editor",
  Viewer: "a Viewer",
} as const satisfies Readonly<Record<InvitationToSend["role"], string>>;

const invitationEmail = (publicUrl: string, invitation: InvitationToSend): EmailMessage => ({
  to: invitation.address,
  subject: `Join ${invitation.workspaceName} on Better Answers`,
  text: [
    `You are invited to join ${invitation.workspaceName} on Better Answers as ${ROLE_WITH_ARTICLE[invitation.role]}.`,
    "",
    "To accept, open this link and sign in with this email address:",
    `${publicUrl}${ACCEPT_INVITATION_PATH}/${invitation.invitationId}`,
    "",
    `The invitation lasts until ${LONG_UK_DATE.format(new Date(invitation.expiresAt))}. If you did not expect it, ignore this email.`,
  ].join("\n"),
});

/** A failed send leaves the invitation standing: the answer says so, and the Admin resends. */
export const sentInvitation = async (
  ctx: { readonly sendEmail: EmailSender; readonly publicUrl: string; readonly log: Logger },
  invitation: InvitationToSend,
): Promise<boolean> => {
  const sent = await attempt(() => ctx.sendEmail(invitationEmail(ctx.publicUrl, invitation)));
  if (!sent.ok) {
    // The error is the relay's, which may quote the address; the id is enough to find it.
    ctx.log.warn(
      { event: "trpc.email_failed", invitation_id: invitation.invitationId },
      "the invitation email did not go",
    );
  }
  return sent.ok;
};

/** What the wire answers: the invitation, and whether its email went. */
export const invitationAnswer = (invitation: InvitationToSend, emailSent: boolean) => ({
  invitationId: invitation.invitationId,
  address: invitation.address,
  role: invitation.role,
  invitedAt: invitation.invitedAt,
  expiresAt: invitation.expiresAt,
  emailSent,
});
