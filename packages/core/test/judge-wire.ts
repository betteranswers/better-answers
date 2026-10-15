import { z } from "zod";

import { conceptIriOf } from "@better-answers/schema";

import type { ReturnedConcept } from "../src/answering/index.ts";
import { openModelClient, type ModelClient } from "../src/llm/index.ts";

/** One `Answer` a judge is asked about, as `ask` returns it. */
export const A_CANDIDATE: ReturnedConcept = {
  iri: conceptIriOf("01J6AAAAAAAAAAAAAAAAAAAAAA"),
  url: "/knowledge/search/01J6AAAAAAAAAAAAAAAAAAAAAA",
  kind: "Answer",
  title: "How long are audit logs kept?",
  collection: "audits",
  body: "Audit logs are kept for thirteen months.\n",
  trust: {
    tier: "unverified",
    status: "current",
    verifiedBy: null,
    verifiedAt: null,
    rider: null,
  },
  trustWords: "Unverified",
  evidence: [],
};

/** A request as the fake wire saw it. */
export type WireSent = { readonly url: string; readonly headers: unknown; readonly body: string };

/** A model client whose wire keeps what it is sent and answers each request as `answer` does. */
export const clientAnswering = (
  answer: (body: string) => Promise<Response>,
): { readonly sent: WireSent[]; readonly client: ModelClient } => {
  const sent: WireSent[] = [];
  const client = openModelClient({
    fetch: async (input, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      const url = input instanceof Request ? input.url : input.toString();
      sent.push({ url, headers: init?.headers, body });
      return answer(body);
    },
    clock: { now: () => new Date() },
    log: { info: () => {} },
  });
  return { sent, client };
};

const messagesBody = z.object({ messages: z.array(z.object({ content: z.string() })) });

/** The prompt a Messages request body carried. */
export const promptOf = (body: string): string =>
  messagesBody.parse(JSON.parse(body)).messages[0]?.content ?? "";

/** Each candidate's number, by the question it was written for, as the judge's prompt names them. */
export const candidatesIn = (prompt: string): ReadonlyMap<string, string> =>
  new Map(
    [
      ...prompt.matchAll(
        /<candidate number="(\d+)">\n<collection>[^<]*<\/collection>\n<written_for>([^<]*)<\/written_for>/g,
      ),
    ].map(([, place = "", title = ""]) => [title, place]),
  );

/** A Messages reply whose one text block is `text`, at a stated usage. */
const messagesReplyOf = (text: string): string =>
  JSON.stringify({
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1_580, output_tokens: 96 },
  });

const decisionBody = z.object({
  questions: z.record(
    z.string(),
    z.object({ instructions: z.object({ written_for: z.string() }) }),
  ),
});

/** Each candidate's question id, by the question it was written for, as a decision call names them. */
export const decisionCandidatesIn = (body: string): ReadonlyMap<string, string> =>
  new Map(
    Object.entries(decisionBody.parse(JSON.parse(body)).questions).map(([id, question]) => [
      question.instructions.written_for,
      id,
    ]),
  );

/**
 * Workers AI's reply giving each candidate the probability of yes `yes` holds for its title, and
 * nought to the rest.
 */
export const decisionReplyTo = (yes: ReadonlyMap<string, number>, body: string): string =>
  JSON.stringify({
    result: {
      model: "clef-flash",
      answers: Object.fromEntries(
        [...decisionCandidatesIn(body)].map(([title, id]) => [
          id,
          { type: "noul", noul: yes.get(title) ?? 0 },
        ]),
      ),
      usage: { input_tokens: 2_400, output_tokens: 3 },
    },
    success: true,
    errors: [],
    messages: [],
  });

/** Each concept's number in a drafting prompt, by its title. */
export const conceptNumbersIn = (prompt: string): ReadonlyMap<string, string> =>
  new Map(
    [
      ...prompt.matchAll(/<concept number="(\d+)">\n<kind>[^<]*<\/kind>\n<title>([^<]*)<\/title>/g),
    ].map(([, number = "", title = ""]) => [title, number]),
  );

const sse = (event: string, data: object): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

type StreamedUsage = { readonly input_tokens: number; readonly output_tokens: number };

/** A streamed Messages reply writing `pieces`, a delta each, its events in the documented order. */
export const streamedEventsOf = (
  pieces: readonly string[],
  usage: StreamedUsage = { input_tokens: 2_100, output_tokens: 140 },
  stopReason = "end_turn",
): readonly string[] => [
  sse("message_start", {
    type: "message_start",
    message: {
      id: "msg_02",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-sonnet-5-5",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: usage.input_tokens, output_tokens: 1 },
    },
  }),
  sse("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  }),
  sse("ping", { type: "ping" }),
  ...pieces.map((text) =>
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    }),
  ),
  sse("content_block_stop", { type: "content_block_stop", index: 0 }),
  sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: usage.output_tokens },
  }),
  sse("message_stop", { type: "message_stop" }),
];

/** An error the provider sends inside a stream it has begun. */
export const OVERLOADED_EVENT = sse("error", {
  type: "error",
  error: { type: "overloaded_error", message: "Overloaded" },
});

type Streaming = {
  /** Awaited before chunk `at` is sent; a chunk never awaited for is sent at once. */
  readonly before?: (at: number) => Promise<void>;
  /** As `fetch`'s own: once aborted, the body errors as a cut connection's does. */
  readonly signal?: AbortSignal | null | undefined;
};

/** A 200 whose body sends each chunk in turn, as a provider streams. */
export const streamedResponse = (
  chunks: readonly string[],
  { before, signal }: Streaming = {},
): Response => {
  const encoder = new TextEncoder();
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      signal?.addEventListener("abort", () => {
        controller.error(new DOMException("aborted", "AbortError"));
      });
    },
    pull: async (controller) => {
      if (at === chunks.length) {
        controller.close();
        return;
      }
      await before?.(at);
      if (signal?.aborted === true) return;
      controller.enqueue(encoder.encode(chunks[at] ?? ""));
      at += 1;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

/** The reply of a judge saying yes to each candidate written for one of `fits`, no to the rest. */
export const judgeReplyTo = (fits: readonly string[], body: string): string =>
  messagesReplyOf(
    JSON.stringify(
      Object.fromEntries(
        [...candidatesIn(promptOf(body))].map(([title, place]) => [
          place,
          fits.includes(title) ? "yes" : "no",
        ]),
      ),
    ),
  );
