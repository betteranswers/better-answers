import { find, findInput, open, openInput, type OpenResult } from "@better-answers/core/answering";
import { err, NOT_FOUND, ok, type Result } from "@better-answers/core/kernel";

import { crossing, given, parsedBy, queryProcedure, router } from "./base.ts";

type Found = Extract<OpenResult, { readonly found: true }>;

/** An absent concept and a withheld one are the one refusal, so neither tells the web which. */
const foundOrRefused = <Refused>(
  opened: Result<OpenResult, Refused>,
): Result<Found, Refused | typeof NOT_FOUND> => {
  if (!opened.ok) return opened;
  return opened.value.found ? ok(opened.value) : err(NOT_FOUND);
};

export const knowledgeRouter = router({
  find: queryProcedure.input(parsedBy(findInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      find.name,
      given(input, (asked) => find(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  open: queryProcedure.input(parsedBy(openInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      open.name,
      given(input, async (asked) =>
        foundOrRefused(await open(ctx.principal, ctx.tx, asked, ctx.clock.now())),
      ),
    ),
  ),
});
