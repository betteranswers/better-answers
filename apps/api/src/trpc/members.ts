import { changeRole, changeRoleInput, listMembers } from "@better-answers/core/members";

import {
  answeredBy,
  crossing,
  mutationProcedure,
  parsedBy,
  queryProcedure,
  router,
} from "./base.ts";

export const membersRouter = router({
  list: queryProcedure.query(({ ctx }) =>
    crossing(ctx, listMembers.name, listMembers(ctx.principal, ctx.tx)),
  ),
  changeRole: mutationProcedure.input(parsedBy(changeRoleInput)).mutation(answeredBy(changeRole)),
});
