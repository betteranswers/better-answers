import { listWorkspaces } from "@better-answers/core/workspaces";

import { crossing, operatorProcedure, router } from "./base.ts";

export const consoleRouter = router({
  workspaces: router({
    list: operatorProcedure.query(({ ctx }) =>
      crossing(ctx, listWorkspaces.name, listWorkspaces(ctx.operator, ctx.tx)),
    ),
  }),
});
