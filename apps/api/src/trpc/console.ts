import {
  listWorkspaces,
  revokeCredentials,
  revokeCredentialsInput,
} from "@better-answers/core/workspaces";

import { crossing, given, operatorProcedure, parsedBy, router } from "./base.ts";

export const consoleRouter = router({
  people: router({
    revokeCredentials: operatorProcedure
      .input(parsedBy(revokeCredentialsInput))
      .mutation(({ ctx, input }) =>
        crossing(
          ctx,
          revokeCredentials.name,
          given(input, (asked) =>
            revokeCredentials(ctx.operator, ctx.tx, { ...asked, at: ctx.clock.now() }),
          ),
        ),
      ),
  }),
  workspaces: router({
    list: operatorProcedure.query(({ ctx }) =>
      crossing(ctx, listWorkspaces.name, listWorkspaces(ctx.operator, ctx.tx)),
    ),
  }),
});
