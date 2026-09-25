import { octetInputParser } from "@trpc/server/http";

import { err } from "@better-answers/core/kernel";
import { listRoutes } from "@better-answers/core/llm";
import { runsOfSubject, runsOfSubjectInput } from "@better-answers/core/runs";
import {
  bindUpload,
  dismissAsNotSpecialCategory,
  dismissAsNotSpecialCategoryInput,
  findingsOf,
  findingsOfInput,
  keepInText,
  keepInTextInput,
  listBindings,
  narrowBinding,
  narrowBindingInput,
  narrowDocuments,
  narrowDocumentsInput,
  previewChunks,
  previewChunksInput,
  publishBinding,
  publishBindingInput,
  widenBinding,
  widenBindingInput,
} from "@better-answers/core/sources";
import { readMembership, standingAsOperator } from "@better-answers/core/workspaces";

import {
  answeredBy,
  crossing,
  given,
  mutationProcedure,
  ownTransactionProcedure,
  parsedBy,
  personProcedure,
  queryProcedure,
  router,
} from "./base.ts";
import { consoleRouter } from "./console.ts";
import { membersRouter } from "./members.ts";
import { personRouter } from "./person.ts";
import { descriptorOf, uploadDoorsOf } from "./upload.ts";

export const appRouter = router({
  session: router({
    membership: queryProcedure.query(({ ctx }) =>
      crossing(ctx, readMembership.name, readMembership(ctx.principal, ctx.tx)),
    ),
    operator: personProcedure.query(({ ctx }) =>
      crossing(
        ctx,
        standingAsOperator.name,
        standingAsOperator(ctx.doors.postgres, { userId: ctx.personId, issuedAt: ctx.issuedAt }),
      ),
    ),
  }),
  person: personRouter,
  console: consoleRouter,
  members: membersRouter,
  routes: router({
    list: queryProcedure.query(({ ctx }) =>
      crossing(ctx, listRoutes.name, listRoutes(ctx.principal, ctx.tx)),
    ),
  }),
  sources: router({
    list: queryProcedure.query(({ ctx }) =>
      crossing(ctx, listBindings.name, listBindings(ctx.principal, ctx.tx)),
    ),
    bind: ownTransactionProcedure.input(octetInputParser).mutation(({ ctx, input }) =>
      crossing(
        ctx,
        bindUpload.name,
        given(descriptorOf(ctx.headers), async (fields) => {
          const doors = uploadDoorsOf(ctx.doors);
          if (!doors.ok) return err(doors.error);
          return bindUpload(ctx.principal, doors.value, { ...fields, body: input });
        }),
      ),
    ),
    findings: queryProcedure.input(parsedBy(findingsOfInput)).query(answeredBy(findingsOf)),
    keepInText: mutationProcedure.input(parsedBy(keepInTextInput)).mutation(answeredBy(keepInText)),
    narrowDocuments: mutationProcedure
      .input(parsedBy(narrowDocumentsInput))
      .mutation(answeredBy(narrowDocuments)),
    dismissAsNotSpecialCategory: mutationProcedure
      .input(parsedBy(dismissAsNotSpecialCategoryInput))
      .mutation(answeredBy(dismissAsNotSpecialCategory)),
    publish: mutationProcedure.input(parsedBy(publishBindingInput)).mutation(({ ctx, input }) =>
      crossing(
        ctx,
        publishBinding.name,
        given(input, (asked) =>
          publishBinding(ctx.principal, ctx.tx, { ...asked, publishedAt: ctx.clock.now() }),
        ),
      ),
    ),
    narrow: mutationProcedure
      .input(parsedBy(narrowBindingInput))
      .mutation(answeredBy(narrowBinding)),
    widen: mutationProcedure.input(parsedBy(widenBindingInput)).mutation(answeredBy(widenBinding)),
    preview: queryProcedure.input(parsedBy(previewChunksInput)).query(answeredBy(previewChunks)),
  }),
  runs: router({
    ofSubject: queryProcedure.input(parsedBy(runsOfSubjectInput)).query(answeredBy(runsOfSubject)),
  }),
});

export type AppRouter = typeof appRouter;
