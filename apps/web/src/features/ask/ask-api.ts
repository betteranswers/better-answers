import { useMutation } from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import { useEffect, useRef, useState } from "react";

import { askedFrom, type Asked } from "@/shared/api/ask-stream.ts";
import { useTRPC, useTRPCClient, type ApiError } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

/** The procedure answers a stream, read here one event at a time. */
type Streamed = inferOutput<Api["ask"]["question"]>;

type AskEvent = Streamed extends AsyncIterable<infer Event> ? Event : never;

type AskResult = Extract<AskEvent, { readonly kind: "result" }>["result"];

type AskInput = inferInput<Api["ask"]["question"]>;

export type Phase = Extract<AskEvent, { readonly kind: "phase" }>["phase"];

export type FeedbackInput = inferInput<Api["ask"]["giveFeedback"]>;

type Told = Exclude<AskEvent, { readonly kind: "keep-alive" }>;

type Asking = {
  /** Until the stream ends, however it ends. */
  readonly streaming: boolean;
  /** What the stream said, with no keep-alive: phases, the result, then the prose. */
  readonly told: readonly Told[];
  /** Why the stream ended without its result, or partway through its prose. */
  readonly failure: Error | ApiError | undefined;
};

const NOT_ASKED: Asking = { streaming: false, told: [], failure: undefined };

/** The first phase is said before the api says it, so the press shows at once. */
const FIRST_PHASE = "reading" satisfies Phase;

const phaseOf = (told: readonly Told[]): Phase => {
  const said = told.findLast((event) => event.kind === "phase");
  return said?.kind === "phase" ? said.phase : FIRST_PHASE;
};

const isTold = (event: AskEvent): event is Told => event.kind !== "keep-alive";

export type Answering = {
  readonly streaming: boolean;
  readonly phase: Phase;
  readonly answer: Asked<AskResult> | undefined;
  readonly failure: Error | ApiError | undefined;
  /** Asks nothing while an answer still streams, so a second press starts no second question. */
  readonly ask: (input: AskInput) => void;
};

/**
 * The plain client with no query around it, so neither a refocus nor a failure asks again.
 * Leaving the page ends the stream.
 */
export const useAnswering = (): Answering => {
  const client = useTRPCClient();
  const [asking, setAsking] = useState<Asking>(NOT_ASKED);
  /** Held apart from the state, so two presses in one task still start one question. */
  const reading = useRef<AbortController | undefined>(undefined);

  useEffect(
    () => () => {
      reading.current?.abort();
    },
    [],
  );

  const read = async (input: AskInput, controller: AbortController): Promise<void> => {
    try {
      const events = await client.ask.question.mutate(input, { signal: controller.signal });
      for await (const event of events) {
        if (controller.signal.aborted) return;
        if (isTold(event)) setAsking((held) => ({ ...held, told: [...held.told, event] }));
      }
      setAsking((held) => ({ ...held, streaming: false }));
    } catch (failure) {
      if (controller.signal.aborted) return;
      const said = failure instanceof Error ? failure : new Error(String(failure));
      setAsking((held) => ({ ...held, streaming: false, failure: said }));
    } finally {
      if (reading.current === controller) reading.current = undefined;
    }
  };

  return {
    streaming: asking.streaming,
    phase: phaseOf(asking.told),
    answer: askedFrom<AskResult>(asking.told),
    failure: asking.failure,
    ask: (input) => {
      if (reading.current !== undefined) return;
      const controller = new AbortController();
      reading.current = controller;
      setAsking({ streaming: true, told: [], failure: undefined });
      void read(input, controller);
    },
  };
};

/** One per control, so a second control's press never drops the first's answer. */
export const useGiveFeedback = () => {
  const api = useTRPC();
  return useMutation(api.ask.giveFeedback.mutationOptions());
};
