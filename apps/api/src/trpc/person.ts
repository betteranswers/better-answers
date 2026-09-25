import { setTimeout as elapsed } from "node:timers/promises";

import { requestAccess, requestAccessInput } from "@better-answers/core/members";
import { setDisplayName, setDisplayNameInput } from "@better-answers/core/workspaces";

import { ASK_TO_JOIN_ANSWER_FLOOR_MS, ASK_TO_JOIN_PERSON_RULE } from "../auth/constants.ts";
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
});
