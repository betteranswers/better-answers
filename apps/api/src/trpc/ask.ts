import {
  ask,
  askInput,
  draftAnswer,
  feedbackInput,
  giveFeedback,
  readYourQuestions,
  readYourRecord,
  yourQuestionsInput,
  yourRecordInput,
  type AnswerResult,
  type AskInput,
  type DraftEvent,
} from "@better-answers/core/answering";
import type { Malformed, Result } from "@better-answers/core/kernel";

import { draftStepsFor, stepsFor } from "../ask-steps.ts";
import { eventsOf, type KeepAlive } from "../ask-stream.ts";
import {
  crossing,
  given,
  mutationProcedure,
  ownTransactionCounted,
  parsedBy,
  queryProcedure,
  router,
  type AskingContext,
} from "./base.ts";
import { KNOWLEDGE_CEILING } from "./knowledge.ts";

type AskPhase = "reading" | "judging" | "drafting";

type AskEvent =
  | { readonly kind: "phase"; readonly phase: AskPhase }
  | { readonly kind: "result"; readonly result: AnswerResult }
  | DraftEvent
  | KeepAlive;

export const askingProcedure = ownTransactionCounted(KNOWLEDGE_CEILING);

const answered = async (
  ctx: AskingContext,
  input: Result<AskInput, Malformed>,
  leaving: AbortSignal,
  emit: (event: AskEvent) => void,
): Promise<void> => {
  emit({ kind: "phase", phase: "reading" });
  if (!input.ok) {
    await crossing(ctx, ask.name, Promise.resolve(input));
    return;
  }
  const doors = { door: ctx.doors.postgres, clock: ctx.clock, ...ctx.modelDoors };
  const steps = stepsFor(doors, ctx.principal, "trpc", leaving);
  let judgingSaid = false;
  const sayJudging = (): void => {
    if (!judgingSaid) emit({ kind: "phase", phase: "judging" });
    judgingSaid = true;
  };
  const judging = {
    ...steps,
    callModel: ((to, call) => {
      sayJudging();
      return steps.callModel(to, call);
    }) satisfies typeof steps.callModel,
    decide: ((to, call) => {
      sayJudging();
      return steps.decide(to, call);
    }) satisfies typeof steps.decide,
  };
  const result = await crossing(
    ctx,
    ask.name,
    ask(ctx.principal, judging, input.value, ctx.clock.now()),
  );
  emit({ kind: "result", result });
  const draftSteps = draftStepsFor(doors, ctx.principal);
  const drafting = {
    ...draftSteps,
    streamModel: ((to, call) => {
      emit({ kind: "phase", phase: "drafting" });
      return draftSteps.streamModel(to, call);
    }) satisfies typeof draftSteps.streamModel,
  };
  const drafted = draftAnswer(ctx.principal, drafting, result, {
    question: input.value.question,
    signal: leaving,
  });
  let step = await drafted.next();
  while (step.done !== true) {
    emit(step.value);
    step = await drafted.next();
  }
  await crossing(ctx, draftAnswer.name, Promise.resolve(step.value)).catch(() => {});
};

export const askRouter = router({
  question: askingProcedure.input(parsedBy(askInput)).mutation(async function* ({
    ctx,
    input,
    signal,
  }): AsyncGenerator<AskEvent, void> {
    const reading = new AbortController();
    const leaving =
      signal === undefined ? reading.signal : AbortSignal.any([signal, reading.signal]);
    try {
      yield* eventsOf<AskEvent>(
        (emit) => answered(ctx, input, leaving, emit),
        ctx.askKeepAliveMs,
        leaving,
      );
    } finally {
      reading.abort();
    }
  }),
  giveFeedback: mutationProcedure.input(parsedBy(feedbackInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      giveFeedback.name,
      given(input, (asked) => giveFeedback(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  yourQuestions: queryProcedure.input(parsedBy(yourQuestionsInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      readYourQuestions.name,
      given(input, (asked) => readYourQuestions(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  yourRecord: queryProcedure.input(parsedBy(yourRecordInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      readYourRecord.name,
      given(input, (asked) => readYourRecord(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
});
