import { find, findInput, open, openInput, type OpenResult } from "@better-answers/core/answering";
import { err, NOT_FOUND, ok, type Result } from "@better-answers/core/kernel";

import { MCP_TOKEN_RULE } from "../auth/constants.ts";
import { crossing, given, parsedBy, queryCeiling, router } from "./base.ts";

type Found = Extract<OpenResult, { readonly found: true }>;

/** An absent concept and a withheld one are the one refusal, so neither tells the web which. */
const foundOrRefused = <Refused>(
  opened: Result<OpenResult, Refused>,
): Result<Found, Refused | typeof NOT_FOUND> => {
  if (!opened.ok) return opened;
  return opened.value.found ? ok(opened.value) : err(NOT_FOUND);
};

/** A person reading on the web spends what one connection does over MCP, find and open together. */
export const knowledgeReadProcedure = queryCeiling({ budget: "knowledge", rule: MCP_TOKEN_RULE });

export const knowledgeRouter = router({
  find: knowledgeReadProcedure.input(parsedBy(findInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      find.name,
      given(input, (asked) => find(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  open: knowledgeReadProcedure.input(parsedBy(openInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      open.name,
      given(input, async (asked) =>
        foundOrRefused(await open(ctx.principal, ctx.tx, asked, ctx.clock.now())),
      ),
    ),
  ),
});
