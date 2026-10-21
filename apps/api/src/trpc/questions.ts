import {
  closeFlag,
  closeFlagInput,
  questionsAskedInput,
  readQuestionsAsked,
} from "@better-answers/core/answering";

import { crossing, given, mutationProcedure, parsedBy, queryProcedure, router } from "./base.ts";

export const questionsRouter = router({
  asked: queryProcedure.input(parsedBy(questionsAskedInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      readQuestionsAsked.name,
      given(input, (asked) => readQuestionsAsked(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  closeFlag: mutationProcedure.input(parsedBy(closeFlagInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      closeFlag.name,
      given(input, (asked) => closeFlag(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
});
