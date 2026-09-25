import { listMembers } from "@better-answers/core/members";

import { crossing, queryProcedure, router } from "./base.ts";

export const membersRouter = router({
  list: queryProcedure.query(({ ctx }) =>
    crossing(ctx, listMembers.name, listMembers(ctx.principal, ctx.tx)),
  ),
});
