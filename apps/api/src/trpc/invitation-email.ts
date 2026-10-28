import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";
import type { InvitationToSend } from "@better-answers/core/members";

import { LONG_UK_DATE } from "../email/email-page.ts";
import type { EmailMessage, Mail } from "../email/email.ts";
import { PRODUCT_NAME } from "../product-name.ts";

const ACCEPT_INVITATION_PATH = "/invitations";

const ROLE_WITH_ARTICLE = {
  Admin: "an Admin",
  Editor: "an Editor",
  Viewer: "a Viewer",
} as const satisfies Readonly<Record<InvitationToSend["role"], string>>;

const invitationEmail = (publicUrl: string, invitation: InvitationToSend): EmailMessage => ({
  to: invitation.address,
  subject: `Join ${invitation.workspaceName} on ${PRODUCT_NAME}`,
  text: [
    `You are invited to join ${invitation.workspaceName} on ${PRODUCT_NAME} as ${ROLE_WITH_ARTICLE[invitation.role]}.`,
    "",
    "To accept, open this link and sign in with this email address:",
    `${publicUrl}${ACCEPT_INVITATION_PATH}/${invitation.invitationId}`,
    "",
    `The invitation lasts until ${LONG_UK_DATE.format(new Date(invitation.expiresAt))}. If you did not expect it, ignore this email.`,
  ].join("\n"),
});

export const sentInvitation = async (
  ctx: { readonly mail: Mail; readonly log: Logger },
  invitation: InvitationToSend,
): Promise<boolean> => {
  const { mail } = ctx;
  const sent = await attempt(() => mail.send(invitationEmail(mail.publicUrl, invitation)));
  if (!sent.ok) {
    ctx.log.warn(
      { event: "trpc.email_failed", invitation_id: invitation.invitationId },
      "the invitation email did not go",
    );
  }
  return sent.ok;
};
