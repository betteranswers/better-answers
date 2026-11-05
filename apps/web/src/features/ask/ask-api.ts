import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import { useEffect, useRef, useState } from "react";

import { askedFrom, type Asked } from "@/shared/api/ask-stream.ts";
import { useTRPC, useTRPCClient, type ApiError } from "@/shared/api/trpc.ts";

type Api = ReturnType<typeof useTRPC>;

type Streamed = inferOutput<Api["ask"]["question"]>;

type AskEvent = Streamed extends AsyncIterable<infer Event> ? Event : never;

type AskResult = Extract<AskEvent, { readonly kind: "result" }>["result"];

type AskInput = inferInput<Api["ask"]["question"]>;

export type Phase = Extract<AskEvent, { readonly kind: "phase" }>["phase"];

export type FeedbackInput = inferInput<Api["ask"]["giveFeedback"]>;

type Told = Exclude<AskEvent, { readonly kind: "keep-alive" }>;

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
  readonly ask: (input: AskInput) => void;
};

export const useAnswering = (): Answering => {
  const client = useTRPCClient();
  const [told, setTold] = useState<readonly Told[]>([]);
  /** A ref, not mutation state, so two presses before React re-renders start only one question. */
  const reading = useRef<AbortController | undefined>(undefined);

  useEffect(
    () => () => {
      reading.current?.abort();
    },
    [],
  );

  const asking = useMutation({
    mutationFn: async ({ input, controller }: { input: AskInput; controller: AbortController }) => {
      try {
        const events = await client.ask.question.mutate(input, { signal: controller.signal });
        for await (const event of events) {
          if (controller.signal.aborted) return;
          if (isTold(event)) setTold((held) => [...held, event]);
        }
      } catch (failure) {
        if (!controller.signal.aborted) throw failure;
      } finally {
        if (reading.current === controller) reading.current = undefined;
      }
    },
  });

  return {
    streaming: asking.isPending,
    phase: phaseOf(told),
    answer: askedFrom<AskResult>(told),
    failure: asking.error ?? undefined,
    ask: (input) => {
      if (reading.current !== undefined) return;
      const controller = new AbortController();
      reading.current = controller;
      setTold([]);
      asking.mutate({ input, controller });
    },
  };
};

/** Each control calls this hook, so pressing one control never drops another control's result. */
export const useGiveFeedback = () => {
  const api = useTRPC();
  return useMutation(api.ask.giveFeedback.mutationOptions());
};

export type YourRecord = inferOutput<Api["ask"]["yourRecord"]>;

export const useYourQuestions = () => {
  const api = useTRPC();
  return useInfiniteQuery(
    api.ask.yourQuestions.infiniteQueryOptions(
      {},
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
};

export type YourQuestions = ReturnType<typeof useYourQuestions>;

export const useYourRecord = (id: string) => {
  const api = useTRPC();
  return useQuery(api.ask.yourRecord.queryOptions({ id }));
};
