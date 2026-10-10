import { octetInputParser } from "@trpc/server/http";

import { err } from "@better-answers/core/kernel";
import { listModelChoices } from "@better-answers/core/llm";
import { runsOfSubject, runsOfSubjectInput } from "@better-answers/core/runs";
import {
  connectUpload,
  dismissAsNotSpecialCategory,
  dismissAsNotSpecialCategoryInput,
  findingsOf,
  findingsOfInput,
  keepInText,
  keepInTextInput,
  listConnectedSources,
  narrowConnectedSource,
  narrowConnectedSourceInput,
  narrowDocuments,
  narrowDocumentsInput,
  previewPassages,
  previewPassagesInput,
  publishConnectedSource,
  publishConnectedSourceInput,
  widenConnectedSource,
  widenConnectedSourceInput,
} from "@better-answers/core/sources";
import { readMember, standingAsOperator } from "@better-answers/core/workspaces";

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
import { knowledgeRouter } from "./knowledge.ts";
import { membersRouter } from "./members.ts";
import { personRouter } from "./person.ts";
import { descriptorOf, uploadDoorsOf } from "./upload.ts";

export const appRouter = router({
  session: router({
    member: queryProcedure.query(({ ctx }) =>
      crossing(ctx, readMember.name, readMember(ctx.principal, ctx.tx)),
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
  knowledge: knowledgeRouter,
  modelChoices: router({
    list: queryProcedure.query(({ ctx }) =>
      crossing(ctx, listModelChoices.name, listModelChoices(ctx.principal, ctx.tx)),
    ),
  }),
  sources: router({
    list: queryProcedure.query(({ ctx }) =>
      crossing(ctx, listConnectedSources.name, listConnectedSources(ctx.principal, ctx.tx)),
    ),
    connect: ownTransactionProcedure.input(octetInputParser).mutation(({ ctx, input }) =>
      crossing(
        ctx,
        connectUpload.name,
        given(descriptorOf(ctx.headers), async (fields) => {
          const doors = uploadDoorsOf(ctx.doors);
          if (!doors.ok) return err(doors.error);
          return connectUpload(ctx.principal, doors.value, { ...fields, body: input });
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
    publish: mutationProcedure
      .input(parsedBy(publishConnectedSourceInput))
      .mutation(({ ctx, input }) =>
        crossing(
          ctx,
          publishConnectedSource.name,
          given(input, (asked) =>
            publishConnectedSource(ctx.principal, ctx.tx, {
              ...asked,
              publishedAt: ctx.clock.now(),
            }),
          ),
        ),
      ),
    narrow: mutationProcedure
      .input(parsedBy(narrowConnectedSourceInput))
      .mutation(answeredBy(narrowConnectedSource)),
    widen: mutationProcedure
      .input(parsedBy(widenConnectedSourceInput))
      .mutation(answeredBy(widenConnectedSource)),
    preview: queryProcedure
      .input(parsedBy(previewPassagesInput))
      .query(answeredBy(previewPassages)),
  }),
  runs: router({
    ofSubject: queryProcedure.input(parsedBy(runsOfSubjectInput)).query(answeredBy(runsOfSubject)),
  }),
});

export type AppRouter = typeof appRouter;
