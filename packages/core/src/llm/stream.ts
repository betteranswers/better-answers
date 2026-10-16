import { attempt } from "../kernel/index.ts";
import {
  afterAttempt,
  ATTEMPT_TIMEOUT_MS,
  attemptLine,
  attemptSignal,
  lostTo,
  MS_PER_SECOND,
  waitFor,
  type AttemptRead,
  type ModelClientDoors,
  type ModelToCall,
  type Unanswered,
} from "./client.ts";
import type { CallSize, CallSpent } from "./spend.ts";
import {
  messagesRead,
  messagesStreamRequest,
  sseDataIn,
  streamEventRead,
  type MessagesStreamCall,
  type StreamEventRead,
} from "./wire/messages.ts";
import type { TokensSpent, WireRequest } from "./wire/read.ts";

export type StreamedCall = {
  readonly system: string;
  readonly prompt: string;
  /** Its `tokensOut` is each attempt's `max_tokens`, so no attempt spends past the reservation. */
  readonly most: CallSize;
  readonly withinMs?: number;
  readonly signal?: AbortSignal;
};

/** Each attempt is one `CallSpent`, which settles the call's reservation as it stands. */
export type StreamedOutcome = {
  readonly outcome: "answered" | Unanswered;
  readonly spent: readonly CallSpent[];
};

export type StreamModel = (
  to: ModelToCall,
  call: StreamedCall,
) => AsyncGenerator<string, StreamedOutcome, undefined>;

export type StreamingClient = { readonly streamModel: StreamModel };

const STREAMED_REQUESTS: Partial<
  Record<ModelToCall["provider"], (call: MessagesStreamCall) => WireRequest>
> = { anthropic: messagesStreamRequest };

const NO_TOKENS: TokensSpent = { tokensIn: 0, tokensOut: 0 };

const ANSWERED = 200;

type Hearing = {
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly stopReason?: string | null;
  readonly stopped: boolean;
  readonly errored: boolean;
};

const NOTHING_HEARD: Hearing = { stopped: false, errored: false };

const hearing = (heard: Hearing, event: StreamEventRead): Hearing => {
  switch (event.event) {
    case "started":
      return { ...heard, tokensIn: event.spent.tokensIn };
    case "delta":
      return {
        ...heard,
        tokensIn: Math.max(heard.tokensIn ?? 0, event.spent.tokensIn),
        tokensOut: event.spent.tokensOut,
        stopReason: event.stopReason,
      };
    case "stopped":
      return { ...heard, stopped: true };
    case "error":
      return { ...heard, errored: true };
    default:
      return heard;
  }
};

type HeardRead = Extract<
  AttemptRead["read"],
  "answered" | "refused" | "cut-off" | "failed" | "timed-out" | "abandoned"
>;

const heardRead = (
  heard: Hearing,
  signal: AbortSignal,
  caller: AbortSignal | undefined,
): HeardRead => {
  if (heard.errored) return "failed";
  if (!heard.stopped) {
    const lost = lostTo(signal, caller, { read: "failed" }).read;
    return lost === "abandoned" || lost === "timed-out" ? lost : "failed";
  }
  if (heard.stopReason === "end_turn") return "answered";
  return heard.stopReason === "refusal" ? "refused" : "cut-off";
};

const heardSpent = (heard: Hearing, most: CallSize): TokensSpent => ({
  tokensIn: heard.tokensIn ?? most.tokensIn,
  tokensOut: heard.tokensOut ?? most.tokensOut,
});

type Ending = { readonly read: HeardRead; readonly spent: TokensSpent };

const cutShort = (read: AttemptRead, sent: boolean, most: CallSize): TokensSpent =>
  read.read === "abandoned" && sent ? most : NO_TOKENS;

async function* heardFrom(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  call: StreamedCall,
): AsyncGenerator<string, Ending, undefined> {
  const reader = body.getReader();
  const cancel = (): void => {
    reader.cancel().catch(() => {
      // Cancelling a reader already closed or errored has nothing left to end.
    });
  };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let heard = NOTHING_HEARD;
  let buffered = "";
  try {
    while (!heard.errored) {
      const chunk = await attempt(() => reader.read());
      if (!chunk.ok || chunk.value.done) break;
      const { data, rest } = sseDataIn(
        buffered + decoder.decode(chunk.value.value, { stream: true }),
      );
      buffered = rest;
      for (const event of data.map(streamEventRead)) {
        heard = hearing(heard, event);
        if (event.event === "text" && event.text !== "") yield event.text;
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
  return { read: heardRead(heard, signal, call.signal), spent: heardSpent(heard, call.most) };
}

type Tried = (
  | { readonly streamed: true; readonly heard: HeardRead }
  | { readonly streamed: false; readonly read: AttemptRead }
) & {
  readonly spent: TokensSpent;
  readonly status: number | null;
  readonly requestId: string | null;
};

const readOf = (tried: Tried): AttemptRead["read"] =>
  tried.streamed ? tried.heard : tried.read.read;

const outcomeOf = (tried: Tried): "answered" | "refused" | "failed" =>
  tried.streamed && (tried.heard === "answered" || tried.heard === "refused")
    ? tried.heard
    : "failed";

export const openStreamingClient = (doors: ModelClientDoors): StreamingClient => {
  const wait = doors.wait ?? waitFor;
  const timeout = doors.timeout ?? ((ms: number) => AbortSignal.timeout(ms));
  const nowMs = (): number => doors.clock.now().getTime();

  async function* attemptOnce(
    request: WireRequest,
    timeoutMs: number,
    call: StreamedCall,
  ): AsyncGenerator<string, Tried, undefined> {
    const sent = call.signal?.aborted !== true;
    const signal = attemptSignal(timeout(timeoutMs), call.signal);
    const { url, ...init } = request;
    const replied = await attempt(() => doors.fetch(url, { ...init, signal }));
    if (!replied.ok) {
      const read = lostTo(signal, call.signal, { read: "unavailable" });
      const spent = cutShort(read, sent, call.most);
      return { read, streamed: false, spent, status: null, requestId: null };
    }
    const response = replied.value;
    const { status } = response;
    const requestId = response.headers.get("request-id");
    if (status === ANSWERED && response.body !== null) {
      const ending = yield* heardFrom(response.body, signal, call);
      return { streamed: true, heard: ending.read, spent: ending.spent, status, requestId };
    }
    const retryAfter = response.headers.get("retry-after");
    const body = await attempt(() => response.text());
    const read = body.ok
      ? messagesRead(status, body.value, retryAfter)
      : lostTo(signal, call.signal, messagesRead(status, "", retryAfter));
    const spent = "spent" in read ? read.spent : cutShort(read, true, call.most);
    return { read, streamed: false, spent, status, requestId };
  }

  const logged = (to: ModelToCall, attempted: number, tried: Tried, seconds: number): void => {
    doors.log.info(
      attemptLine(to, attempted, { ...tried, read: readOf(tried), seconds }),
      "llm: a model call's attempt",
    );
  };

  async function* streamModel(
    to: ModelToCall,
    call: StreamedCall,
  ): AsyncGenerator<string, StreamedOutcome, undefined> {
    const requestOf = STREAMED_REQUESTS[to.provider];
    if (requestOf === undefined) return { outcome: "failed", spent: [] };
    const request = requestOf({
      model: to.model,
      key: to.key.reveal(),
      system: call.system,
      prompt: call.prompt,
      tokensOut: call.most.tokensOut,
    });
    const startedMs = nowMs();
    const leftMs = (): number =>
      (call.withinMs ?? Number.POSITIVE_INFINITY) - (nowMs() - startedMs);
    const spent: CallSpent[] = [];
    for (let attempted = 1; ; attempted += 1) {
      const triedAt = nowMs();
      const tried = yield* attemptOnce(request, Math.min(ATTEMPT_TIMEOUT_MS, leftMs()), call);
      const seconds = (nowMs() - triedAt) / MS_PER_SECOND;
      logged(to, attempted, tried, seconds);
      const outcome = outcomeOf(tried);
      spent.push({
        ...tried.spent,
        seconds,
        outcome: outcome === "answered" ? "succeeded" : "failed",
      });
      if (tried.streamed) return { outcome, spent };
      const ended = await afterAttempt(tried.read, attempted, leftMs, call.signal, wait);
      if (ended !== undefined) return { outcome: ended, spent };
    }
  }

  return { streamModel };
};
