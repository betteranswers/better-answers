import {
  ask,
  askInput,
  feedbackInput,
  giveFeedback,
  type AnswerResult,
} from "@better-answers/core/answering";

import { stepsFor } from "../ask-steps.ts";
import {
  crossing,
  given,
  mutationProcedure,
  ownTransactionCounted,
  parsedBy,
  router,
} from "./base.ts";
import { KNOWLEDGE_CEILING } from "./knowledge.ts";

/** The first event of an answer's stream: the whole result, before any prose. */
type AskEvent = { readonly kind: "result"; readonly result: AnswerResult };

/** Holds no transaction while the model is called, and spends from the knowledge reads' budget. */
export const askingProcedure = ownTransactionCounted(KNOWLEDGE_CEILING);

export const askRouter = router({
  /**
   * A mutation, so it is refused over GET, carries the question in its body and is never retried:
   * a failed call cannot pay twice.
   */
  question: askingProcedure.input(parsedBy(askInput)).mutation(async function* ({
    ctx,
    input,
  }): AsyncGenerator<AskEvent, void> {
    const doors = { door: ctx.doors.postgres, clock: ctx.clock, ...ctx.modelDoors };
    const result = await crossing(
      ctx,
      ask.name,
      given(input, (asked) =>
        ask(ctx.principal, stepsFor(doors, ctx.principal, "trpc"), asked, ctx.clock.now()),
      ),
    );
    yield { kind: "result", result };
  }),
  giveFeedback: mutationProcedure.input(parsedBy(feedbackInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      giveFeedback.name,
      given(input, (asked) => giveFeedback(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
});
