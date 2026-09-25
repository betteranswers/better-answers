import {
  cancelInvitation,
  changeRole,
  changeRoleInput,
  invitationInput,
  inviteMember,
  inviteMemberInput,
  listInvitations,
  listMembers,
  readAuditLog,
  readAuditLogInput,
  resendInvitation,
  type InvitationToSend,
} from "@better-answers/core/members";

import {
  answeredBy,
  committedAs,
  crossing,
  given,
  mutationProcedure,
  ownTransactionProcedure,
  parsedBy,
  queryProcedure,
  router,
} from "./base.ts";
import { invitationAnswer, sentInvitation } from "./invitation-email.ts";

type Emailing = Parameters<typeof sentInvitation>[0];

const emailedAfterCommit = async (ctx: Emailing, invitation: InvitationToSend) =>
  invitationAnswer(invitation, await sentInvitation(ctx, invitation));

export const membersRouter = router({
  list: queryProcedure.query(({ ctx }) =>
    crossing(ctx, listMembers.name, listMembers(ctx.principal, ctx.tx)),
  ),
  changeRole: mutationProcedure.input(parsedBy(changeRoleInput)).mutation(answeredBy(changeRole)),
  auditLog: queryProcedure.input(parsedBy(readAuditLogInput)).query(answeredBy(readAuditLog)),
  invitations: queryProcedure.query(({ ctx }) =>
    crossing(ctx, listInvitations.name, listInvitations(ctx.principal, ctx.tx)),
  ),
  invite: ownTransactionProcedure
    .input(parsedBy(inviteMemberInput))
    .mutation(async ({ ctx, input }) => {
      const invited = await crossing(
        ctx,
        inviteMember.name,
        given(input, (asked) =>
          committedAs(ctx, (principal, tx) =>
            inviteMember(principal, tx, { ...asked, now: ctx.clock.now() }),
          ),
        ),
      );
      return emailedAfterCommit(ctx, invited);
    }),
  resendInvitation: ownTransactionProcedure
    .input(parsedBy(invitationInput))
    .mutation(async ({ ctx, input }) => {
      const resent = await crossing(
        ctx,
        resendInvitation.name,
        given(input, (asked) =>
          committedAs(ctx, (principal, tx) =>
            resendInvitation(principal, tx, { ...asked, now: ctx.clock.now() }),
          ),
        ),
      );
      return emailedAfterCommit(ctx, resent);
    }),
  cancelInvitation: mutationProcedure
    .input(parsedBy(invitationInput))
    .mutation(answeredBy(cancelInvitation)),
});
