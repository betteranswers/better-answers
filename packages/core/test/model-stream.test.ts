import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  openModelClient,
  openStreamingClient,
  type ModelAttemptLine,
  type ModelToCall,
  type StreamedCall,
  type StreamedOutcome,
} from "../src/llm/index.ts";
import { OVERLOADED_EVENT, streamedEventsOf, streamedResponse } from "./judge-wire.ts";

const A_KEY = "sk-test-u17-invented-key-0001";
const SONNET = "claude-sonnet-5-5";
const NOW = new Date("2026-10-15T09:00:00.000Z");

const SYSTEM = "Answer from the concepts given.";
const PROMPT = "How long are audit logs kept?";

const MOST = { tokensIn: 40_000, tokensOut: 16_000 };

const TO_SONNET: ModelToCall = {
  purpose: "answering",
  modelChoiceId: "answering-1",
  provider: "anthropic",
  model: SONNET,
  key: { reveal: () => A_KEY },
};

const A_CALL: StreamedCall = { system: SYSTEM, prompt: PROMPT, most: MOST };

type Answering = (signal: AbortSignal | null | undefined) => Response | Promise<Response>;

/** A fake at the wire answering each attempt in turn; past its answers it answers a teapot. */
const theWire = (...answers: readonly Answering[]) => {
  const sent: { readonly url: string; readonly init: RequestInit }[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    sent.push({ url: input instanceof Request ? input.url : input.toString(), init });
    const answer = answers[sent.length - 1] ?? (() => new Response("", { status: 418 }));
    return answer(init.signal);
  };
  return { sent, fetch };
};

type Wire = ReturnType<typeof theWire>;

const doorsOn = (wire: Wire) => {
  const lines: ModelAttemptLine[] = [];
  const waits: number[] = [];
  return {
    lines,
    waits,
    doors: {
      fetch: wire.fetch,
      clock: { now: () => NOW },
      log: { info: (line: ModelAttemptLine) => lines.push(line) },
      wait: async (ms: number) => {
        waits.push(ms);
      },
      timeout: () => new AbortController().signal,
    },
  };
};

/** Every text a streamed call yields, and how it ended. */
const drained = async (
  wire: Wire,
  call: StreamedCall = A_CALL,
): Promise<{ texts: string[]; ended: StreamedOutcome; lines: ModelAttemptLine[] }> => {
  const { doors, lines } = doorsOn(wire);
  const reply = openStreamingClient(doors).streamModel(TO_SONNET, call);
  const texts: string[] = [];
  let step = await reply.next();
  while (step.done !== true) {
    texts.push(step.value);
    step = await reply.next();
  }
  return { texts, ended: step.value, lines };
};

const streaming =
  (chunks: readonly string[]): Answering =>
  (signal) =>
    streamedResponse(chunks, { signal });

const OVERLOADED: Answering = () =>
  new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error" } }), {
    status: 529,
  });

const PIECES = ["Audit logs are kept", " for thirteen months.[^1]\n"];

/** Its input as the reply opened with it, and its output at the size reserved, never counted. */
const FAILED_AT_FULL_SIZE = {
  outcome: "failed",
  spent: [{ tokensIn: 2_100, tokensOut: 16_000, seconds: 0, outcome: "failed" }],
};

describe("the streamed Messages shape", () => {
  it("sends the model, its key and a streamed body", async () => {
    const wire = theWire(streaming(streamedEventsOf(PIECES)));

    await drained(wire);

    expect(wire.sent.map(({ url, init }) => [url, init.method, init.headers])).toEqual([
      [
        "https://api.anthropic.com/v1/messages",
        "POST",
        {
          "content-type": "application/json",
          "x-api-key": A_KEY,
          "anthropic-version": "2023-06-01",
        },
      ],
    ]);
    expect(
      JSON.parse(typeof wire.sent[0]?.init.body === "string" ? wire.sent[0].init.body : ""),
    ).toEqual({
      model: SONNET,
      max_tokens: 16_000,
      system: SYSTEM,
      messages: [{ role: "user", content: PROMPT }],
      stream: true,
    });
  });

  it("yields text as it arrives, then its closing usage", async () => {
    const wire = theWire(streaming(streamedEventsOf(PIECES)));

    const { texts, ended } = await drained(wire);

    expect(texts).toEqual(PIECES);
    expect(ended).toEqual({
      outcome: "answered",
      spent: [{ tokensIn: 2_100, tokensOut: 140, seconds: 0, outcome: "succeeded" }],
    });
  });

  it("reads events each split across chunks of the wire", async () => {
    const halves = streamedEventsOf(PIECES).flatMap((event) => {
      const half = Math.floor(event.length / 2);
      return [event.slice(0, half), event.slice(half)];
    });
    const wire = theWire(streaming(halves));

    const { texts, ended } = await drained(wire);

    expect(texts).toEqual(PIECES);
    expect(ended).toEqual({
      outcome: "answered",
      spent: [{ tokensIn: 2_100, tokensOut: 140, seconds: 0, outcome: "succeeded" }],
    });
  });

  it("keeps a character whole across a chunk's edge", async () => {
    const encoded = new TextEncoder().encode(streamedEventsOf(["The supplier’s logs"]).join(""));
    const quote = encoded.findIndex((byte) => byte === 0xe2);
    const wire = theWire(
      () =>
        new Response(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(encoded.slice(0, quote + 1));
              controller.enqueue(encoded.slice(quote + 1));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );

    const { texts } = await drained(wire);

    expect(texts).toEqual(["The supplier’s logs"]);
  });

  it("fails an error sent with the stop in one chunk", async () => {
    const events = streamedEventsOf(PIECES);
    const wire = theWire(
      streaming([[...events.slice(0, -2), OVERLOADED_EVENT, ...events.slice(-2)].join("")]),
    );

    const { ended } = await drained(wire);

    expect(ended.outcome).toBe("failed");
  });

  it("bounds each attempt by the call's deadline, in seconds spent", async () => {
    const wire = theWire(streaming(streamedEventsOf(PIECES)), streaming(streamedEventsOf(PIECES)));
    const timeouts: number[] = [];
    let ticks = 0;
    const doors = {
      ...doorsOn(wire).doors,
      clock: { now: () => new Date(NOW.getTime() + 1_000 * ticks++) },
      timeout: (ms: number) => {
        timeouts.push(ms);
        return new AbortController().signal;
      },
    };
    const client = openStreamingClient(doors);

    const within = client.streamModel(TO_SONNET, { ...A_CALL, withinMs: 30_000 });
    for (let step = await within.next(); step.done !== true; step = await within.next());
    const unbounded = client.streamModel(TO_SONNET, A_CALL);
    let ended = await unbounded.next();
    while (ended.done !== true) ended = await unbounded.next();

    expect(timeouts).toEqual([28_000, 120_000]);
    expect(ended.value.spent.map(({ seconds }) => seconds)).toEqual([2]);
  });

  it("reads its own timeout mid-stream as timed out", async () => {
    const timedOut = new AbortController();
    const events = streamedEventsOf(PIECES);
    const wire = theWire((signal) =>
      streamedResponse(events, {
        signal,
        before: async (at) => {
          if (at === events.findIndex((event) => event.includes("for thirteen months")))
            timedOut.abort();
        },
      }),
    );
    const doors = { ...doorsOn(wire).doors, timeout: () => timedOut.signal };
    const lines: ModelAttemptLine[] = [];
    const reply = openStreamingClient({
      ...doors,
      log: { info: (line) => lines.push(line) },
    }).streamModel(TO_SONNET, A_CALL);

    let ended = await reply.next();
    while (ended.done !== true) ended = await reply.next();

    expect([ended.value, lines.map(({ read }) => read)]).toEqual([
      FAILED_AT_FULL_SIZE,
      ["timed-out"],
    ]);
  });

  it("tells a spend cap from a rate limit, unstreamed", async () => {
    const capped: Answering = () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "rate_limit_error",
            message: "Spend limit reached.",
            details: { error_code: "enforced_spend_limit_reached" },
          },
        }),
        { status: 429 },
      );

    const { ended } = await drained(theWire(capped));

    expect(ended.outcome).toBe("spend-cap");
  });

  it("sends nothing to a model no streamed form speaks", async () => {
    const wire = theWire(streaming(streamedEventsOf(PIECES)));
    const reply = openStreamingClient(doorsOn(wire).doors).streamModel(
      { ...TO_SONNET, provider: "cloudflare" },
      A_CALL,
    );

    const ended = await reply.next();

    expect([ended, wire.sent]).toEqual([
      { done: true, value: { outcome: "failed", spent: [] } },
      [],
    ]);
  });

  it("tries an unreachable provider again", async () => {
    const unreachable: Answering = () => {
      throw new TypeError("fetch failed");
    };
    const wire = theWire(unreachable, streaming(streamedEventsOf(PIECES)));

    const { ended, lines } = await drained(wire);

    expect(ended.outcome).toBe("answered");
    expect(lines.map(({ read, status }) => [read, status])).toEqual([
      ["unavailable", null],
      ["answered", 200],
    ]);
  });

  it("yields its first text before the reply has ended", async () => {
    const events = streamedEventsOf(PIECES);
    const held = Promise.withResolvers<void>();
    const firstText = events.findIndex((event) => event.includes("text_delta"));
    const wire = theWire((signal) =>
      streamedResponse(events, {
        signal,
        before: (at) => (at === firstText + 1 ? held.promise : Promise.resolve()),
      }),
    );
    const reply = openStreamingClient(doorsOn(wire).doors).streamModel(TO_SONNET, A_CALL);

    const first = await reply.next();
    held.resolve();
    const rest = [];
    for (let step = await reply.next(); step.done !== true; step = await reply.next()) {
      rest.push(step.value);
    }

    expect([first, rest]).toEqual([{ done: false, value: PIECES[0] }, [PIECES[1]]]);
  });

  it("fails an error mid-stream, billing what it never counted", async () => {
    const events = streamedEventsOf(PIECES);
    const wire = theWire(streaming([...events.slice(0, 4), OVERLOADED_EVENT, ...events.slice(4)]));

    const { texts, ended, lines } = await drained(wire);

    expect(texts).toEqual([PIECES[0]]);
    expect(ended).toEqual(FAILED_AT_FULL_SIZE);
    expect(wire.sent).toHaveLength(1);
    expect(lines.map(({ read, status }) => [read, status])).toEqual([["failed", 200]]);
  });

  it("fails a stream that ends before saying it stopped", async () => {
    const wire = theWire(streaming(streamedEventsOf(PIECES).slice(0, 5)));

    const { ended } = await drained(wire);

    expect(ended).toEqual(FAILED_AT_FULL_SIZE);
  });

  it("fails a reply cut off at its token limit, once", async () => {
    const usage = { input_tokens: 2_100, output_tokens: 16_000 };
    const wire = theWire(streaming(streamedEventsOf(PIECES, usage, "max_tokens")));

    const { ended, lines } = await drained(wire);

    expect(ended).toEqual(FAILED_AT_FULL_SIZE);
    expect(lines.map(({ read }) => read)).toEqual(["cut-off"]);
  });

  it("answers a refusal with the tokens it was billed", async () => {
    const wire = theWire(streaming(streamedEventsOf([], undefined, "refusal")));

    const { ended } = await drained(wire);

    expect(ended).toEqual({
      outcome: "refused",
      spent: [{ tokensIn: 2_100, tokensOut: 140, seconds: 0, outcome: "failed" }],
    });
  });

  it("tries an overload before any stream again", async () => {
    const wire = theWire(OVERLOADED, streaming(streamedEventsOf(PIECES)));
    const { doors, waits } = doorsOn(wire);
    const reply = openStreamingClient(doors).streamModel(TO_SONNET, A_CALL);

    let step = await reply.next();
    while (step.done !== true) step = await reply.next();

    expect(step.value).toEqual({
      outcome: "answered",
      spent: [
        { tokensIn: 0, tokensOut: 0, seconds: 0, outcome: "failed" },
        { tokensIn: 2_100, tokensOut: 140, seconds: 0, outcome: "succeeded" },
      ],
    });
    expect(waits).toEqual([2_000]);
  });
});

/** A judge's call, with no stream, that `signal` may end. */
const judgedUntil = (doors: ReturnType<typeof doorsOn>["doors"], signal: AbortSignal) =>
  openModelClient(doors).callModel(TO_SONNET, {
    system: SYSTEM,
    prompt: PROMPT,
    answer: z.object({}),
    most: MOST,
    signal,
  });

describe("a caller's abort", () => {
  it("ends the streamed request and tries no other", async () => {
    const leaving = new AbortController();
    const events = streamedEventsOf(PIECES);
    const firstText = events.findIndex((event) => event.includes("text_delta"));
    const wire = theWire((signal) =>
      streamedResponse(events, {
        signal,
        before: async (at) => {
          if (at === firstText + 1) leaving.abort();
        },
      }),
    );

    const { texts, ended, lines } = await drained(wire, { ...A_CALL, signal: leaving.signal });

    expect(wire.sent[0]?.init.signal?.aborted).toBe(true);
    expect(texts).toEqual([PIECES[0]]);
    expect(ended).toEqual(FAILED_AT_FULL_SIZE);
    expect(lines.map(({ read }) => read)).toEqual(["abandoned"]);
  });

  it("settles a judge's request it ended at the reserved size", async () => {
    const leaving = new AbortController();
    const wire = theWire(async (signal) => {
      leaving.abort();
      if (signal?.aborted === true) throw new DOMException("aborted", "AbortError");
      return new Response("", { status: 500 });
    });
    const { doors, lines } = doorsOn(wire);

    const ended = await judgedUntil(doors, leaving.signal);

    expect(ended).toEqual({
      outcome: "failed",
      spent: [{ tokensIn: 40_000, tokensOut: 16_000, seconds: 0, outcome: "failed" }],
    });
    expect(wire.sent).toHaveLength(1);
    expect(lines.map(({ read }) => read)).toEqual(["abandoned"]);
  });

  it("settles a stream ended before replying at its reserved size", async () => {
    const leaving = new AbortController();
    const wire = theWire(async (signal) => {
      leaving.abort();
      if (signal?.aborted === true) throw new DOMException("aborted", "AbortError");
      return new Response("", { status: 500 });
    });

    const { ended, lines } = await drained(wire, { ...A_CALL, signal: leaving.signal });

    expect(ended).toEqual({
      outcome: "failed",
      spent: [{ tokensIn: 40_000, tokensOut: 16_000, seconds: 0, outcome: "failed" }],
    });
    expect(lines.map(({ read }) => read)).toEqual(["abandoned"]);
  });

  it("settles a stream ended before it was sent at nothing", async () => {
    const wire = theWire(async (signal) => {
      if (signal?.aborted === true) throw new DOMException("aborted", "AbortError");
      return new Response("", { status: 500 });
    });

    const { ended } = await drained(wire, { ...A_CALL, signal: AbortSignal.abort() });

    expect(ended.spent).toEqual([{ tokensIn: 0, tokensOut: 0, seconds: 0, outcome: "failed" }]);
  });

  it("settles a request ended before it was sent at nothing", async () => {
    const wire = theWire(async (signal) => {
      if (signal?.aborted === true) throw new DOMException("aborted", "AbortError");
      return new Response("", { status: 500 });
    });
    const { doors } = doorsOn(wire);

    const ended = await judgedUntil(doors, AbortSignal.abort());

    expect(ended.spent).toEqual([{ tokensIn: 0, tokensOut: 0, seconds: 0, outcome: "failed" }]);
  });

  it("makes no attempt after an abort during its wait", async () => {
    const leaving = new AbortController();
    const wire = theWire(OVERLOADED, OVERLOADED);
    const { doors } = doorsOn(wire);
    const waited = {
      ...doors,
      wait: async () => {
        leaving.abort();
      },
    };

    const ended = await judgedUntil(waited, leaving.signal);

    expect(ended.outcome).toBe("failed");
    expect(wire.sent).toHaveLength(1);
  });
});

const sse = (data: object | string): string =>
  `event: message\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

const opening = (usage: object) => sse({ type: "message_start", message: { usage } });

const text = (said: string) =>
  sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: said } });

const closing = (usage: object, stopReason = "end_turn") =>
  sse({ type: "message_delta", delta: { stop_reason: stopReason }, usage });

const STOP = sse({ type: "message_stop" });

const START = opening({ input_tokens: 10, output_tokens: 1 });

const CLOSED = closing({ output_tokens: 7 });

describe("reading a streamed reply's events", () => {
  it("reads events with CRLF ends, comments and split data", async () => {
    const split = [
      "event: message\r\n",
      'data: {"type":"content_block_delta","index":0,\r\n',
      'data: "delta":{"type":"text_delta","text":"Kept."}}\r\n\r\n',
    ].join("");
    const wire = theWire(streaming([START, ": a comment\n\n", split, CLOSED, STOP]));

    const { texts, ended } = await drained(wire);

    expect([texts, ended.outcome]).toEqual([["Kept."], "answered"]);
  });

  it("yields text alone, passing over thinking and pings", async () => {
    const thinking = sse({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Hm." },
    });
    const pinged = sse({ type: "ping" });
    const wire = theWire(
      streaming([START, thinking, pinged, text("Kept."), text(""), CLOSED, STOP]),
    );

    const { texts } = await drained(wire);

    expect(texts).toEqual(["Kept."]);
  });

  it("counts cached input in the opening event", async () => {
    const cached = opening({
      input_tokens: 10,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 3_000,
      output_tokens: 1,
    });
    const wire = theWire(streaming([cached, text("Kept."), CLOSED, STOP]));

    const { ended } = await drained(wire);

    expect(ended.spent).toEqual([
      { tokensIn: 3_210, tokensOut: 7, seconds: 0, outcome: "succeeded" },
    ]);
  });

  it("takes a closing delta's larger input count", async () => {
    const counted = closing({ input_tokens: 2_100, cache_read_input_tokens: 9, output_tokens: 7 });
    const wire = theWire(streaming([START, text("Kept."), counted, STOP]));

    const { ended } = await drained(wire);

    expect(ended.spent).toEqual([
      { tokensIn: 2_109, tokensOut: 7, seconds: 0, outcome: "succeeded" },
    ]);
  });

  it("fails on data that is no JSON, sending nothing after", async () => {
    const broken = sse("{not json");
    const wire = theWire(streaming([START, broken, text("Lost."), CLOSED, STOP]));

    const { texts, ended } = await drained(wire);

    expect([texts, ended.outcome]).toEqual([[], "failed"]);
  });
});
