import { setDisplayName, setDisplayNameInput } from "@better-answers/core/workspaces";

import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { crossing, given, parsedBy, personProcedure, router } from "./base.ts";

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
});
