import type { Logger } from "pino";

import type { Clock, Malformed, OperatorPrincipal, Result } from "@better-answers/core/kernel";
import { listNamesWaiting } from "@better-answers/core/members";
import type { Tx } from "@better-answers/core/store/postgres";
import {
  correctDisplayName,
  correctDisplayNameInput,
  inspectPerson,
  inspectPersonInput,
  listPeople,
  listPeopleInput,
  listWorkspaces,
  revokeCredentials,
  revokeCredentialsInput,
} from "@better-answers/core/workspaces";

import type { RefusalAnswer } from "../refusal.ts";
import { crossing, given, operatorProcedure, parsedBy, router } from "./base.ts";

type AsTheOperator = {
  readonly log: Logger;
  readonly clock: Clock;
  readonly operator: OperatorPrincipal;
  readonly tx: Tx;
};

/**
 * The sign-in's age is judged against the procedure's own instant. The act's function name labels
 * its logs; never pass an anonymous one.
 */
const writtenNow =
  <Input, Value>(
    act: (
      operator: OperatorPrincipal,
      tx: Tx,
      input: Input & { readonly at: Date },
    ) => Promise<Result<Value, RefusalAnswer | Error>>,
  ) =>
  ({
    ctx,
    input,
  }: {
    readonly ctx: AsTheOperator;
    readonly input: Result<Input, Malformed>;
  }): Promise<Value> =>
    crossing(
      ctx,
      act.name,
      given(input, (asked) => act(ctx.operator, ctx.tx, { ...asked, at: ctx.clock.now() })),
    );

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
      .mutation(writtenNow(revokeCredentials)),
    namesWaiting: operatorProcedure.query(({ ctx }) =>
      crossing(ctx, listNamesWaiting.name, listNamesWaiting(ctx.operator, ctx.tx)),
    ),
    correctDisplayName: operatorProcedure
      .input(parsedBy(correctDisplayNameInput))
      .mutation(writtenNow(correctDisplayName)),
  }),
  workspaces: router({
    list: operatorProcedure.query(({ ctx }) =>
      crossing(ctx, listWorkspaces.name, listWorkspaces(ctx.operator, ctx.tx)),
    ),
  }),
});
