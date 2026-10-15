import { setTimeout as elapsed } from "node:timers/promises";

import type { Logger } from "pino";

import { type Clock, err, ok, type Result } from "@better-answers/core/kernel";
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
  dismissPasskeyOffer,
  factorChangeStale,
  endOneSession,
  endOneSessionInput,
  endOtherSessions,
  readSecondFactor,
  readSessions,
  readWorkspacesHeld,
  removeAuthenticator,
  removePasskey,
  removePasskeyInput,
  renamePasskey,
  renamePasskeyInput,
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
import type { Doors } from "../doors.ts";
import { sendFactorNotice } from "../factor-notice-email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { sendPromotionNotice } from "../promotion-notice-email.ts";
import type { RefusalAnswer } from "../refusal.ts";
import { crossing, given, parsedBy, personCeiling, personProcedure, router } from "./base.ts";

type ThePerson = {
  readonly personId: string;
  readonly sessionId: string;
  readonly doors: Doors;
  readonly clock: Clock;
  readonly log: Logger;
};

/** A factor change re-confirms where the person already holds a factor; a first one needs none. */
const reconfirmingTheirFactors = async (
  ctx: ThePerson,
): Promise<Result<undefined, "confirmation-too-old" | RefusalAnswer | Error>> => {
  const held = await readSecondFactor(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
    personId: ctx.personId,
    sessionId: ctx.sessionId,
    now: ctx.clock.now(),
  });
  if (!held.ok) return held;
  // A restored person's factor change waits on their restore code alone, never a re-confirm.
  if (held.value.restoreRequired || !factorChangeStale(held.value, ctx.clock.now())) {
    return ok(undefined);
  }
  return err("confirmation-too-old");
};

const crossingTheirFactors = async (ctx: ThePerson): Promise<void> => {
  await crossing(ctx, reconfirmingTheirFactors.name, reconfirmingTheirFactors(ctx));
};

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
  workspaces: personProcedure.query(({ ctx }) =>
    crossing(
      ctx,
      readWorkspacesHeld.name,
      readWorkspacesHeld(IDENTITY_PRINCIPAL, ctx.doors.postgres, { personId: ctx.personId }),
    ),
  ),
  acceptInvitation: personProcedure
    .input(parsedBy(invitationInput))
    .mutation(async ({ ctx, input }) => {
      const { promoted, ...joined } = await crossing(
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
      );
      if (promoted) void sendPromotionNotice(ctx, ctx.personId);
      return joined;
    }),
  sessions: personProcedure.query(({ ctx }) =>
    crossing(
      ctx,
      readSessions.name,
      readSessions(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
        personId: ctx.personId,
        sessionId: ctx.sessionId,
        now: ctx.clock.now(),
      }),
    ),
  ),
  signOutSession: personProcedure.input(parsedBy(endOneSessionInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      endOneSession.name,
      given(input, (asked) =>
        endOneSession(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
          ...asked,
          personId: ctx.personId,
          now: ctx.clock.now(),
        }),
      ),
    ),
  ),
  signOutOtherSessions: personProcedure.mutation(({ ctx }) =>
    crossing(
      ctx,
      endOtherSessions.name,
      endOtherSessions(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
        personId: ctx.personId,
        sessionId: ctx.sessionId,
        now: ctx.clock.now(),
      }),
    ),
  ),
  secondFactor: personProcedure.query(({ ctx }) =>
    crossing(
      ctx,
      readSecondFactor.name,
      readSecondFactor(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
        personId: ctx.personId,
        sessionId: ctx.sessionId,
        now: ctx.clock.now(),
      }),
    ),
  ),
  renamePasskey: personProcedure.input(parsedBy(renamePasskeyInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      renamePasskey.name,
      given(input, (asked) =>
        renamePasskey(IDENTITY_PRINCIPAL, ctx.doors.postgres, { ...asked, personId: ctx.personId }),
      ),
    ),
  ),
  removePasskey: personProcedure
    .input(parsedBy(removePasskeyInput))
    .mutation(async ({ ctx, input }) => {
      await crossingTheirFactors(ctx);
      const removed = await crossing(
        ctx,
        removePasskey.name,
        given(input, (asked) =>
          removePasskey(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
            ...asked,
            personId: ctx.personId,
            sessionId: ctx.sessionId,
          }),
        ),
      );
      void sendFactorNotice(ctx, ctx.email, "passkey-removed");
      return removed;
    }),
  dismissPasskeyOffer: personProcedure.mutation(({ ctx }) =>
    crossing(
      ctx,
      dismissPasskeyOffer.name,
      dismissPasskeyOffer(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
        personId: ctx.personId,
        now: ctx.clock.now(),
      }),
    ),
  ),
  removeAuthenticator: personProcedure.mutation(async ({ ctx }) => {
    await crossingTheirFactors(ctx);
    const removed = await crossing(
      ctx,
      removeAuthenticator.name,
      removeAuthenticator(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
        personId: ctx.personId,
        sessionId: ctx.sessionId,
      }),
    );
    void sendFactorNotice(ctx, ctx.email, "authenticator-removed");
    return removed;
  }),
  replaceRecoveryCodes: personCeiling(RECOVERY_CODES_PERSON_RULE)
    .input(parsedBy(replaceRecoveryCodesInput))
    .mutation(async ({ ctx, input }) => {
      await crossingTheirFactors(ctx);
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
      return {
        recoveryCodes: issued.recoveryCodes,
        madeAt: issued.madeAt,
        replaced: issued.replaced,
      };
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
