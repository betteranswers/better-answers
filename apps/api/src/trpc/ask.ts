import {
  ask,
  askInput,
  draftAnswer,
  feedbackInput,
  giveFeedback,
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
  router,
  type AskingContext,
} from "./base.ts";
import { KNOWLEDGE_CEILING } from "./knowledge.ts";

/** What an answer is doing while nothing else is sent: reading, judging, then drafting. */
type AskPhase = "reading" | "judging" | "drafting";

/** Its phase at once, then the whole result before any prose; a keep-alive carries nothing. */
type AskEvent =
  | { readonly kind: "phase"; readonly phase: AskPhase }
  | { readonly kind: "result"; readonly result: AnswerResult }
  | DraftEvent
  | KeepAlive;

/** Holds no transaction while the model is called, and spends from the knowledge reads' budget. */
export const askingProcedure = ownTransactionCounted(KNOWLEDGE_CEILING);

/** Runs apart from the stream's reader, so a reader who leaves still leaves a completed record. */
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
  // A decision model is asked once per candidate; the phase is said once.
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
  // The result and each part's end are sent already, so a refusal here is logged and not thrown.
  await crossing(ctx, draftAnswer.name, Promise.resolve(step.value)).catch(() => {});
};

export const askRouter = router({
  /**
   * A mutation, so it is refused over GET, carries the question in its body and is never retried:
   * a failed call cannot pay twice.
   */
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
      // The reader is gone or the answer is done; either way no model call is left to run.
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
});
