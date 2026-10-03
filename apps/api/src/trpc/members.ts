import type { Logger } from "pino";

import type { Clock, Malformed, Result, UserPrincipal } from "@better-answers/core/kernel";
import {
  addToGroup,
  approveRequest,
  approveRequestInput,
  bulkAddToGroup,
  bulkAddToGroupInput,
  bulkCancelInvitations,
  bulkChangeRole,
  bulkChangeRoleInput,
  bulkInvitationsInput,
  bulkRemoveMembers,
  bulkRemoveMembersInput,
  bulkResendInvitations,
  cancelInvitation,
  changeRole,
  changeRoleInput,
  countInvitations,
  createGroup,
  createGroupInput,
  declineRequest,
  declineRequestInput,
  deleteGroup,
  deleteGroupInput,
  flagDisplayName,
  flagDisplayNameInput,
  groupMemberInput,
  invitationInput,
  inviteMembers,
  inviteMembersInput,
  listGroups,
  listInvitations,
  listInvitationsInput,
  listMembers,
  listWaitingRequests,
  readActivity,
  readActivityInput,
  readAuditLog,
  readAuditLogInput,
  removeFromGroup,
  removeMember,
  removeMemberInput,
  renameGroup,
  renameGroupInput,
  resendInvitation,
  revokeCredentialsHere,
  revokeCredentialsHereInput,
  type InvitationMinted,
  type InvitationToSend,
} from "@better-answers/core/members";
import type { Tx } from "@better-answers/core/store/postgres";

import type { Doors } from "../doors.ts";
import type { Mail } from "../email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { sendPromotionNotice } from "../promotion-notice-email.ts";
import type { RefusalAnswer } from "../refusal.ts";
import { EMAILS_PER_SECOND } from "../smtp.ts";
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
import { tellTheOperator } from "./name-flag-email.ts";

type Emailing = {
  readonly principal: UserPrincipal;
  readonly doors: Doors;
  readonly mail: Mail;
  readonly log: Logger;
  readonly clock: Clock;
};

type Minting<Asked, Minted> = (
  principal: UserPrincipal,
  tx: Tx,
  input: Asked & { readonly now: Date },
) => Promise<Result<Minted, RefusalAnswer | Error>>;

/** The moment is the server's, and the act answers only once it committed. */
const committedNow = <Asked, Minted>(
  ctx: Emailing,
  act: Minting<Asked, Minted>,
  input: Result<Asked, Malformed>,
): Promise<Minted> =>
  crossing(
    ctx,
    act.name,
    given(input, (asked) =>
      committedAs(ctx, (principal, tx) => act(principal, tx, { ...asked, now: ctx.clock.now() })),
    ),
  );

const answerOf = (invitation: InvitationToSend, emailSent: boolean) => ({
  invitationId: invitation.invitationId,
  address: invitation.address,
  role: invitation.role,
  invitedAt: invitation.invitedAt,
  expiresAt: invitation.expiresAt,
  emailSent,
});

/**
 * Runs an act that mints or renews an invitation, then emails it once the act committed, and
 * answers the invitation with whether its email went.
 */
const committedThenEmailed =
  <Asked>(act: Minting<Asked, InvitationToSend>) =>
  async ({ ctx, input }: { readonly ctx: Emailing; readonly input: Result<Asked, Malformed> }) => {
    const invitation = await committedNow(ctx, act, input);
    return answerOf(invitation, await sentInvitation(ctx, invitation));
  };

/**
 * A round keeps the shared queue one second deep, so another email, such as a sign-in code,
 * waits behind one round, not the whole send.
 */
const emailedEach = async (
  ctx: Emailing,
  invitations: readonly InvitationToSend[],
): Promise<readonly boolean[]> => {
  const sent: boolean[] = [];
  for (let start = 0; start < invitations.length; start += EMAILS_PER_SECOND) {
    const round = invitations.slice(start, start + EMAILS_PER_SECOND);
    sent.push(...(await Promise.all(round.map((invitation) => sentInvitation(ctx, invitation)))));
  }
  return sent;
};

/** As `committedThenEmailed`, for an act on many: each email goes, or fails, on its own. */
const committedThenEmailedEach =
  <Asked, Minted extends InvitationToSend, Answer>(
    act: Minting<Asked, readonly Minted[]>,
    answer: (minted: Minted, emailSent: boolean) => Answer,
  ) =>
  async ({ ctx, input }: { readonly ctx: Emailing; readonly input: Result<Asked, Malformed> }) => {
    const minted = await committedNow(ctx, act, input);
    const sent = await emailedEach(ctx, minted);
    return { invitations: minted.map((one, at) => answer(one, sent[at] === true)) };
  };

type Moving<Asked, Moved> = (
  principal: UserPrincipal,
  tx: Tx,
  input: Asked,
) => Promise<Result<Moved, RefusalAnswer | Error>>;

/** Once the move committed, tells each person it promoted what can confirm their sign-in. */
const movedThenTold =
  <Asked, Moved extends object, Answer>(
    act: Moving<Asked, Moved>,
    told: (moved: Moved) => { readonly promoted: readonly string[]; readonly answer: Answer },
  ) =>
  async ({ ctx, input }: { readonly ctx: Emailing; readonly input: Result<Asked, Malformed> }) => {
    const moved = await crossing(
      ctx,
      act.name,
      given(input, (asked) => committedAs(ctx, (principal, tx) => act(principal, tx, asked))),
    );
    const { promoted, answer } = told(moved);
    const telling = { mail: ctx.mail, log: ctx.log, door: ctx.doors.postgres };
    for (const personId of promoted) {
      void sendPromotionNotice({ ...telling, platform: IDENTITY_PRINCIPAL }, personId);
    }
    return answer;
  };

const mintedAnswer = (minted: InvitationMinted, emailSent: boolean) => ({
  ...answerOf(minted, emailSent),
  replaced: minted.replaced,
});

type AtTheClock = {
  readonly log: Logger;
  readonly principal: UserPrincipal;
  readonly tx: Tx;
  readonly clock: Clock;
};

/** The moment is the server's, read as the act runs. The act's function name labels its logs. */
const answeredAt =
  <Asked, Value>(
    act: (
      principal: UserPrincipal,
      tx: Tx,
      input: Asked & { readonly at: Date },
    ) => Promise<Result<Value, RefusalAnswer | Error>>,
  ) =>
  ({ ctx, input }: { readonly ctx: AtTheClock; readonly input: Result<Asked, Malformed> }) =>
    crossing(
      ctx,
      act.name,
      given(input, (asked) => act(ctx.principal, ctx.tx, { ...asked, at: ctx.clock.now() })),
    );

export const membersRouter = router({
  list: queryProcedure.query(({ ctx }) =>
    crossing(ctx, listMembers.name, listMembers(ctx.principal, ctx.tx)),
  ),
  changeRole: ownTransactionProcedure.input(parsedBy(changeRoleInput)).mutation(
    movedThenTold(changeRole, ({ promoted, ...changed }) => ({
      promoted: promoted ? [changed.personId] : [],
      answer: changed,
    })),
  ),
  auditLog: queryProcedure.input(parsedBy(readAuditLogInput)).query(answeredBy(readAuditLog)),
  activity: queryProcedure.input(parsedBy(readActivityInput)).query(answeredBy(readActivity)),
  invitations: queryProcedure
    .input(parsedBy(listInvitationsInput))
    .query(answeredAt(listInvitations)),
  invitationCounts: queryProcedure.query(({ ctx }) =>
    crossing(
      ctx,
      countInvitations.name,
      countInvitations(ctx.principal, ctx.tx, { at: ctx.clock.now() }),
    ),
  ),
  invite: ownTransactionProcedure
    .input(parsedBy(inviteMembersInput))
    .mutation(committedThenEmailedEach(inviteMembers, mintedAnswer)),
  resendInvitation: ownTransactionProcedure
    .input(parsedBy(invitationInput))
    .mutation(committedThenEmailed(resendInvitation)),
  bulkResendInvitations: ownTransactionProcedure
    .input(parsedBy(bulkInvitationsInput))
    .mutation(committedThenEmailedEach(bulkResendInvitations, answerOf)),
  cancelInvitation: mutationProcedure
    .input(parsedBy(invitationInput))
    .mutation(answeredBy(cancelInvitation)),
  bulkCancelInvitations: mutationProcedure
    .input(parsedBy(bulkInvitationsInput))
    .mutation(answeredBy(bulkCancelInvitations)),
  revokeCredentials: mutationProcedure
    .input(parsedBy(revokeCredentialsHereInput))
    .mutation(answeredAt(revokeCredentialsHere)),
  remove: mutationProcedure.input(parsedBy(removeMemberInput)).mutation(answeredAt(removeMember)),
  bulkChangeRole: ownTransactionProcedure
    .input(parsedBy(bulkChangeRoleInput))
    .mutation(
      movedThenTold(bulkChangeRole, ({ promoted, ...outcome }) => ({ promoted, answer: outcome })),
    ),
  bulkRemove: mutationProcedure
    .input(parsedBy(bulkRemoveMembersInput))
    .mutation(answeredAt(bulkRemoveMembers)),
  bulkAddToGroup: mutationProcedure
    .input(parsedBy(bulkAddToGroupInput))
    .mutation(answeredBy(bulkAddToGroup)),

  /** A constant answer: whether a flag was raised or already waited is the operator's to know. */
  flagDisplayName: ownTransactionProcedure
    .input(parsedBy(flagDisplayNameInput))
    .mutation(async ({ ctx, input }) => {
      const flagged = await crossing(
        ctx,
        flagDisplayName.name,
        given(input, (asked) =>
          committedAs(ctx, (principal, tx) => flagDisplayName(principal, tx, asked)),
        ),
      );
      if (flagged.raised !== null) await tellTheOperator(ctx, flagged.raised);
      return { personId: flagged.personId, sentToTheOperator: true } as const;
    }),
  groups: queryProcedure.query(({ ctx }) =>
    crossing(ctx, listGroups.name, listGroups(ctx.principal, ctx.tx)),
  ),
  createGroup: mutationProcedure
    .input(parsedBy(createGroupInput))
    .mutation(answeredBy(createGroup)),
  renameGroup: mutationProcedure
    .input(parsedBy(renameGroupInput))
    .mutation(answeredBy(renameGroup)),
  deleteGroup: mutationProcedure
    .input(parsedBy(deleteGroupInput))
    .mutation(answeredBy(deleteGroup)),
  addToGroup: mutationProcedure.input(parsedBy(groupMemberInput)).mutation(answeredBy(addToGroup)),
  removeFromGroup: mutationProcedure
    .input(parsedBy(groupMemberInput))
    .mutation(answeredBy(removeFromGroup)),
  requests: queryProcedure.query(({ ctx }) =>
    crossing(ctx, listWaitingRequests.name, listWaitingRequests(ctx.principal, ctx.tx)),
  ),
  approveRequest: ownTransactionProcedure
    .input(parsedBy(approveRequestInput))
    .mutation(committedThenEmailed(approveRequest)),
  declineRequest: mutationProcedure
    .input(parsedBy(declineRequestInput))
    .mutation(answeredBy(declineRequest)),
});
