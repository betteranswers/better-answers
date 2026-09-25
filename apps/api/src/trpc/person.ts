import { requestAccess, requestAccessInput } from "@better-answers/core/members";
import { setDisplayName, setDisplayNameInput } from "@better-answers/core/workspaces";

import { ASK_TO_JOIN_PERSON_RULE } from "../auth/constants.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { crossing, given, parsedBy, personCeiling, personProcedure, router } from "./base.ts";

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
  requestAccess: personCeiling(
    ASK_TO_JOIN_PERSON_RULE,
    "Too many asks to join from this person; try again in an hour.",
  )
    .input(parsedBy(requestAccessInput))
    .mutation(({ ctx, input }) =>
      crossing(
        ctx,
        requestAccess.name,
        given(input, (asked) =>
          requestAccess(IDENTITY_PRINCIPAL, ctx.doors.postgres, {
            ...asked,
            requesterId: ctx.personId,
          }),
        ),
      ),
    ),
});
