import { find, findInput, open, openInput, type OpenResult } from "@better-answers/core/answering";
import {
  collectionsAndOwners,
  conceptToEdit,
  conceptToEditInput,
  kindConceptsInput,
  nameOwner,
  nameOwnerInput,
  readKindConcepts,
  readKnowledgeTree,
  saveConcept,
  saveConceptInput,
  standingOnConcept,
} from "@better-answers/core/concepts";
import {
  attempt,
  err,
  NOT_FOUND,
  ok,
  type Result,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import { passageAt } from "@better-answers/core/sources";
import type { Tx } from "@better-answers/core/store/postgres";

import { MCP_TOKEN_RULE } from "../auth/constants.ts";
import { doorTold } from "../doors.ts";
import {
  answeredBy,
  crossing,
  given,
  mutationProcedure,
  ownTransactionProcedure,
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

const passages = (principal: UserPrincipal, tx: Tx) => (locator: string) =>
  passageAt(principal, tx, locator);

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
      given(input, async (asked) => {
        const found = foundOrRefused(await open(ctx.principal, ctx.tx, asked, ctx.clock.now()));
        if (!found.ok || asked.iri === undefined) return found;
        const { iri } = asked;
        const standing = await attempt(() => standingOnConcept(ctx.principal, ctx.tx, iri));
        return standing.ok ? ok({ ...found.value, standing: standing.value }) : standing;
      }),
    ),
  ),
  tree: knowledgeReadProcedure.query(({ ctx }) =>
    crossing(ctx, readKnowledgeTree.name, readKnowledgeTree(ctx.principal, ctx.tx)),
  ),
  kindConcepts: knowledgeReadProcedure.input(parsedBy(kindConceptsInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      readKindConcepts.name,
      given(input, (asked) => readKindConcepts(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  collections: queryProcedure.query(({ ctx }) =>
    crossing(ctx, collectionsAndOwners.name, collectionsAndOwners(ctx.principal, ctx.tx)),
  ),
  nameOwner: mutationProcedure.input(parsedBy(nameOwnerInput)).mutation(answeredBy(nameOwner)),
  conceptToEdit: knowledgeReadProcedure
    .input(parsedBy(conceptToEditInput))
    .query(({ ctx, input }) =>
      crossing(
        ctx,
        conceptToEdit.name,
        given(input, (asked) =>
          conceptToEdit(ctx.principal, ctx.tx, asked, passages(ctx.principal, ctx.tx)),
        ),
      ),
    ),
  saveConcept: ownTransactionProcedure
    .input(parsedBy(saveConceptInput))
    .mutation(({ ctx, input }) =>
      crossing(
        ctx,
        saveConcept.name,
        given(input, (asked) => {
          const bundle = doorTold(ctx.doors.git, "no bundle store is configured");
          if (!bundle.ok) return Promise.resolve(err(new Error(bundle.error)));
          return saveConcept(
            ctx.principal,
            { git: bundle.value, postgres: ctx.doors.postgres, clock: ctx.doors.clock, passages },
            asked,
          );
        }),
      ),
    ),
});
