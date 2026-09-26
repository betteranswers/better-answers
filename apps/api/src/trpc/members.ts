import type { Logger } from "pino";

import type { Clock, Malformed, Result, UserPrincipal } from "@better-answers/core/kernel";
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
  revokeCredentialsHere,
  revokeCredentialsHereInput,
  type InvitationToSend,
} from "@better-answers/core/members";
import type { Tx } from "@better-answers/core/store/postgres";

import type { Doors } from "../doors.ts";
import type { Mail } from "../email.ts";
import type { RefusalAnswer } from "../refusal.ts";
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
import { sentInvitation } from "./invitation-email.ts";

type Emailing = {
  readonly principal: UserPrincipal;
  readonly doors: Doors;
  readonly mail: Mail;
  readonly log: Logger;
  readonly clock: Clock;
};

/**
 * Runs an act that mints or renews an invitation, then emails it once the act committed, and
 * answers the invitation with whether its email went.
 */
const committedThenEmailed =
  <Asked>(
    act: (
      principal: UserPrincipal,
      tx: Tx,
      input: Asked & { readonly now: Date },
    ) => Promise<Result<InvitationToSend, RefusalAnswer | Error>>,
  ) =>
  async ({ ctx, input }: { readonly ctx: Emailing; readonly input: Result<Asked, Malformed> }) => {
    const invitation = await crossing(
      ctx,
      act.name,
      given(input, (asked) =>
        committedAs(ctx, (principal, tx) => act(principal, tx, { ...asked, now: ctx.clock.now() })),
      ),
    );
    return {
      invitationId: invitation.invitationId,
      address: invitation.address,
      role: invitation.role,
      invitedAt: invitation.invitedAt,
      expiresAt: invitation.expiresAt,
      emailSent: await sentInvitation(ctx, invitation),
    };
  };

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
    .mutation(committedThenEmailed(inviteMember)),
  resendInvitation: ownTransactionProcedure
    .input(parsedBy(invitationInput))
    .mutation(committedThenEmailed(resendInvitation)),
  cancelInvitation: mutationProcedure
    .input(parsedBy(invitationInput))
    .mutation(answeredBy(cancelInvitation)),
  revokeCredentials: mutationProcedure
    .input(parsedBy(revokeCredentialsHereInput))
    .mutation(({ ctx, input }) =>
      crossing(
        ctx,
        revokeCredentialsHere.name,
        given(input, (asked) =>
          revokeCredentialsHere(ctx.principal, ctx.tx, { ...asked, at: ctx.clock.now() }),
        ),
      ),
    ),
});
