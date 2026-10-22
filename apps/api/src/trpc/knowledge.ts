import { find, findInput, open, openInput, type OpenResult } from "@better-answers/core/answering";
import { collectionsAndOwners, nameOwner, nameOwnerInput } from "@better-answers/core/concepts";
import { err, NOT_FOUND, ok, type Result } from "@better-answers/core/kernel";

import { MCP_TOKEN_RULE } from "../auth/constants.ts";
import {
  answeredBy,
  crossing,
  given,
  mutationProcedure,
  parsedBy,
  queryCeiling,
  queryProcedure,
  router,
  type RoadCeiling,
} from "./base.ts";

type Found = Extract<OpenResult, { readonly found: true }>;

const foundOrRefused = <Refused>(
  opened: Result<OpenResult, Refused>,
): Result<Found, Refused | typeof NOT_FOUND> => {
  if (!opened.ok) return opened;
  return opened.value.found ? ok(opened.value) : err(NOT_FOUND);
};

export const KNOWLEDGE_CEILING: RoadCeiling = { budget: "knowledge", rule: MCP_TOKEN_RULE };

export const knowledgeReadProcedure = queryCeiling(KNOWLEDGE_CEILING);

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
  collections: queryProcedure.query(({ ctx }) =>
    crossing(ctx, collectionsAndOwners.name, collectionsAndOwners(ctx.principal, ctx.tx)),
  ),
  nameOwner: mutationProcedure.input(parsedBy(nameOwnerInput)).mutation(answeredBy(nameOwner)),
});
