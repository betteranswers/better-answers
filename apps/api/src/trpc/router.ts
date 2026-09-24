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
} from "@better-answers/core/sources";
import { readMembership } from "@better-answers/core/workspaces";

import {
  crossing,
  given,
  mutationProcedure,
  ownTransactionProcedure,
  parsedBy,
  queryProcedure,
  router,
} from "./base.ts";
import { descriptorOf, uploadDoorsOf } from "./upload.ts";

export const appRouter = router({
  session: router({
    membership: queryProcedure.query(({ ctx }) =>
      crossing(ctx, readMembership.name, readMembership(ctx.principal, ctx.tx)),
    ),
  }),
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
    findings: queryProcedure.input(parsedBy(findingsOfInput)).query(({ ctx, input }) =>
      crossing(
        ctx,
        findingsOf.name,
        given(input, (asked) => findingsOf(ctx.principal, ctx.tx, asked)),
      ),
    ),
    keepInText: mutationProcedure.input(parsedBy(keepInTextInput)).mutation(({ ctx, input }) =>
      crossing(
        ctx,
        keepInText.name,
        given(input, (asked) => keepInText(ctx.principal, ctx.tx, asked)),
      ),
    ),
    narrowDocuments: mutationProcedure
      .input(parsedBy(narrowDocumentsInput))
      .mutation(({ ctx, input }) =>
        crossing(
          ctx,
          narrowDocuments.name,
          given(input, (asked) => narrowDocuments(ctx.principal, ctx.tx, asked)),
        ),
      ),
    dismissAsNotSpecialCategory: mutationProcedure
      .input(parsedBy(dismissAsNotSpecialCategoryInput))
      .mutation(({ ctx, input }) =>
        crossing(
          ctx,
          dismissAsNotSpecialCategory.name,
          given(input, (asked) => dismissAsNotSpecialCategory(ctx.principal, ctx.tx, asked)),
        ),
      ),
    publish: mutationProcedure.input(parsedBy(publishBindingInput)).mutation(({ ctx, input }) =>
      crossing(
        ctx,
        publishBinding.name,
        given(input, (asked) =>
          publishBinding(ctx.principal, ctx.tx, { ...asked, publishedAt: ctx.clock.now() }),
        ),
      ),
    ),
    narrow: mutationProcedure.input(parsedBy(narrowBindingInput)).mutation(({ ctx, input }) =>
      crossing(
        ctx,
        narrowBinding.name,
        given(input, (asked) => narrowBinding(ctx.principal, ctx.tx, asked)),
      ),
    ),
    preview: queryProcedure.input(parsedBy(previewChunksInput)).query(({ ctx, input }) =>
      crossing(
        ctx,
        previewChunks.name,
        given(input, (asked) => previewChunks(ctx.principal, ctx.tx, asked)),
      ),
    ),
  }),
  runs: router({
    ofSubject: queryProcedure.input(parsedBy(runsOfSubjectInput)).query(({ ctx, input }) =>
      crossing(
        ctx,
        runsOfSubject.name,
        given(input, (asked) => runsOfSubject(ctx.principal, ctx.tx, asked)),
      ),
    ),
  }),
});

export type AppRouter = typeof appRouter;
