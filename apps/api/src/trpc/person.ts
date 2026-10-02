import { setTimeout as elapsed } from "node:timers/promises";

import {
  acceptInvitation,
  invitationInput,
  readInvitation,
  readOpenInvitations,
  requestAccess,
  requestAccessInput,
} from "@better-answers/core/members";
import {
  acknowledgeRecoveryCodes,
  acknowledgeRecoveryCodesInput,
  readSecondFactor,
  removeAuthenticator,
  replaceRecoveryCodes,
  replaceRecoveryCodesInput,
  setDisplayName,
  setDisplayNameInput,
} from "@better-answers/core/workspaces";

import {
  ASK_TO_JOIN_ANSWER_FLOOR_MS,
  ASK_TO_JOIN_PERSON_RULE,
  RECOVERY_CODES_PERSON_RULE,
} from "../auth/constants.ts";
import { sendFactorNotice } from "../factor-notice-email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { crossing, given, parsedBy, personCeiling, personProcedure, router } from "./base.ts";

const answeredNoSoonerThan = async <Answer>(
  floorMs: number,
  running: Promise<Answer>,
): Promise<Answer> => {
  const [answer] = await Promise.all([running, elapsed(floorMs)]);
  return answer;
};

export const personRouter = router({
  setDisplayName: personProcedure.input(parsedBy(setDisplayNameInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      setDisplayName.name,
      given(input, (asked) =>
        setDisplayName(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
          personId: ctx.personId,
          displayName: asked.displayName,
        }),
      ),
    ),
  ),
  requestAccess: personCeiling(ASK_TO_JOIN_PERSON_RULE)
    .input(parsedBy(requestAccessInput))
    .mutation(({ ctx, input }) =>
      crossing(
        ctx,
        requestAccess.name,
        answeredNoSoonerThan(
          ASK_TO_JOIN_ANSWER_FLOOR_MS,
          given(input, (asked) =>
            requestAccess(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
              ...asked,
              requesterId: ctx.personId,
            }),
          ),
        ),
      ),
    ),
  invitation: personProcedure.input(parsedBy(invitationInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      readInvitation.name,
      given(input, (asked) =>
        readInvitation(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
          invitationId: asked.invitationId,
          personId: ctx.personId,
          now: ctx.clock.now(),
        }),
      ),
    ),
  ),
  invitations: personProcedure.query(({ ctx }) =>
    crossing(
      ctx,
      readOpenInvitations.name,
      readOpenInvitations(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
        personId: ctx.personId,
        now: ctx.clock.now(),
      }),
    ),
  ),
  acceptInvitation: personProcedure.input(parsedBy(invitationInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      acceptInvitation.name,
      given(input, (asked) =>
        acceptInvitation(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
          invitationId: asked.invitationId,
          personId: ctx.personId,
          sessionId: ctx.sessionId,
          now: ctx.clock.now(),
        }),
      ),
    ),
  ),
  secondFactor: personProcedure.query(({ ctx }) =>
    crossing(
      ctx,
      readSecondFactor.name,
      readSecondFactor(IDENTITY_PRINCIPAL, ctx.doors.postgres, { personId: ctx.personId }),
    ),
  ),
  removeAuthenticator: personProcedure.mutation(async ({ ctx }) => {
    const removed = await crossing(
      ctx,
      removeAuthenticator.name,
      removeAuthenticator(IDENTITY_PRINCIPAL, ctx.doors.postgres, { personId: ctx.personId }),
    );
    void sendFactorNotice(ctx, ctx.email, "authenticator-removed");
    return removed;
  }),
  replaceRecoveryCodes: personCeiling(RECOVERY_CODES_PERSON_RULE)
    .input(parsedBy(replaceRecoveryCodesInput))
    .mutation(async ({ ctx, input }) => {
      const issued = await crossing(
        ctx,
        replaceRecoveryCodes.name,
        given(input, (asked) =>
          replaceRecoveryCodes(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
            personId: ctx.personId,
            replacing: asked.replacing,
            now: ctx.clock.now(),
          }),
        ),
      );
      void sendFactorNotice(ctx, ctx.email, issued.replaced ? "codes-replaced" : "codes-made");
      return { recoveryCodes: issued.recoveryCodes, madeAt: issued.madeAt };
    }),
  acknowledgeRecoveryCodes: personProcedure
    .input(parsedBy(acknowledgeRecoveryCodesInput))
    .mutation(({ ctx, input }) =>
      crossing(
        ctx,
        acknowledgeRecoveryCodes.name,
        given(input, (asked) =>
          acknowledgeRecoveryCodes(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
            personId: ctx.personId,
            madeAt: asked.madeAt,
          }),
        ),
      ),
    ),
});
