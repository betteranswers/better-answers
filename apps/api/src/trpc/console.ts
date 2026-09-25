import {
  inspectPerson,
  inspectPersonInput,
  listPeople,
  listPeopleInput,
  listWorkspaces,
  revokeCredentials,
  revokeCredentialsInput,
} from "@better-answers/core/workspaces";

import { crossing, given, operatorProcedure, parsedBy, router } from "./base.ts";

export const consoleRouter = router({
  people: router({
    list: operatorProcedure.input(parsedBy(listPeopleInput)).query(({ ctx, input }) =>
      crossing(
        ctx,
        listPeople.name,
        given(input, (asked) => listPeople(ctx.operator, ctx.tx, asked)),
      ),
    ),
    inspect: operatorProcedure.input(parsedBy(inspectPersonInput)).query(({ ctx, input }) =>
      crossing(
        ctx,
        inspectPerson.name,
        given(input, (asked) => inspectPerson(ctx.operator, ctx.tx, asked)),
      ),
    ),
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
