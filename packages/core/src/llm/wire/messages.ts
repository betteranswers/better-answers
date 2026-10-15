import { z } from "zod";

import {
  jsonAs,
  retryAfterMsOf,
  type TokensSpent,
  type WireRead,
  type WireRequest,
} from "./read.ts";

/** Each a value the provider publishes; the version pins the shape this file reads and writes. */
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const MESSAGES_VERSION = "2023-06-01";

export type AnswerSchema = z.core.JSONSchema.JSONSchema;

/** One attempt as the Messages API takes it: the answer constrained to a JSON schema. */
export type MessagesCall = {
  readonly model: string;
  readonly key: string;
  readonly system: string;
  readonly prompt: string;
  readonly answerSchema: AnswerSchema;
  readonly tokensOut: number;
};

/** One attempt whose answer is prose, sent as it is written. */
export type MessagesStreamCall = Omit<MessagesCall, "answerSchema">;

/**
 * No `thinking` and no sampling field: a model choice may name a model that refuses either, and
 * each model's default stands.
 */
/** What the reply is asked to be: JSON of a schema, or prose streamed as it is written. */
type Asking =
  | {
      readonly output_config: {
        readonly format: { readonly type: "json_schema"; readonly schema: AnswerSchema };
      };
    }
  | { readonly stream: true };

const requestWith = (call: MessagesStreamCall, asking: Asking): WireRequest => ({
  url: MESSAGES_URL,
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": call.key,
    "anthropic-version": MESSAGES_VERSION,
  },
  body: JSON.stringify({
    model: call.model,
    max_tokens: call.tokensOut,
    system: call.system,
    messages: [{ role: "user", content: call.prompt }],
    ...asking,
  }),
});

export const messagesRequest = ({ answerSchema, ...call }: MessagesCall): WireRequest =>
  requestWith(call, { output_config: { format: { type: "json_schema", schema: answerSchema } } });

/** With no answer shape, prose arrives as server-sent events. */
export const messagesStreamRequest = (call: MessagesStreamCall): WireRequest =>
  requestWith(call, { stream: true });

/** An answer is the text of the reply's blocks, which the caller reads as JSON. */
type MessagesRead = WireRead<string>;

const count = z.number().int().nonnegative();

const reply = z.object({
  // Only a text block carries `text`; a thinking block's is under `thinking`.
  content: z.array(z.object({ text: z.string().optional() })),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: count,
    output_tokens: count,
    cache_creation_input_tokens: count.nullish(),
    cache_read_input_tokens: count.nullish(),
  }),
});

const errorReply = z.object({
  error: z.object({
    type: z.string(),
    message: z.string(),
    details: z.object({ error_code: z.string().optional() }).nullish(),
  }),
});

/** A tier's own monthly cap: a 429 that waiting does not lift. */
const TIER_SPEND_CAP = "enforced_spend_limit_reached";

/**
 * How the provider begins a 400 that only the account's billing lifts: a spend limit the
 * organisation or a workspace set, or credit run out.
 */
const BILLED_OUT = ["You have reached your specified", "Your credit balance is too low"] as const;

/** The provider's own faults and overload, which another attempt may get past. */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([500, 504, 529]);

const BILLING = 402;
const RATE_LIMITED = 429;
const BAD_REQUEST = 400;
const ANSWERED = 200;

/** Cached input is billed too, at its own rate, so every input token is counted. */
const spentOf = (usage: z.output<typeof reply>["usage"]) => ({
  tokensIn:
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0),
  tokensOut: usage.output_tokens,
});

const answeredRead = (text: string): MessagesRead => {
  const parsed = jsonAs(reply, text);
  if (parsed === undefined) return { read: "failed" };
  const spent = spentOf(parsed.usage);
  if (parsed.stop_reason === "refusal") return { read: "refused", spent };
  if (parsed.stop_reason !== "end_turn") return { read: "cut-off", spent };
  const said = parsed.content.map((block) => block.text ?? "");
  return { read: "answered", said: said.join(""), spent };
};

const rateLimitedRead = (text: string, retryAfter: string | null): MessagesRead =>
  jsonAs(errorReply, text)?.error.details?.error_code === TIER_SPEND_CAP
    ? { read: "spend-cap" }
    : { read: "rate-limited", retryAfterMs: retryAfterMsOf(retryAfter) };

const badRequestRead = (text: string): MessagesRead => {
  const message = jsonAs(errorReply, text)?.error.message ?? "";
  return BILLED_OUT.some((begins) => message.startsWith(begins))
    ? { read: "spend-cap" }
    : { read: "failed" };
};

/** Reads one reply by its status first, then its body, which it never hands on beyond the answer. */
export const messagesRead = (
  status: number,
  text: string,
  retryAfter: string | null,
): MessagesRead => {
  if (status === ANSWERED) return answeredRead(text);
  if (status === RATE_LIMITED) return rateLimitedRead(text, retryAfter);
  if (status === BAD_REQUEST) return badRequestRead(text);
  // A billing fault is lifted by paying, never by waiting, as a spend cap is.
  if (status === BILLING) return { read: "spend-cap" };
  return UNAVAILABLE_STATUSES.has(status) ? { read: "unavailable" } : { read: "failed" };
};

/** Each event's data, and what is left over until the blank line that ends the next one. */
type SseRead = { readonly data: readonly string[]; readonly rest: string };

export const sseDataIn = (buffered: string): SseRead => {
  const blocks = buffered.replaceAll("\r\n", "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const data = blocks.flatMap((block) => {
    const lines = block.split("\n").filter((line) => line.startsWith("data:"));
    return lines.length === 0
      ? []
      : [lines.map((line) => line.slice("data:".length).trimStart()).join("\n")];
  });
  return { data, rest };
};

/** What one event of a streamed reply says; an event this file does not read is `other`. */
export type StreamEventRead =
  | { readonly event: "text"; readonly text: string }
  | { readonly event: "started"; readonly spent: TokensSpent }
  | { readonly event: "delta"; readonly stopReason: string | null; readonly spent: TokensSpent }
  | { readonly event: "stopped" }
  | { readonly event: "error" }
  | { readonly event: "other" };

const started = z.object({
  type: z.literal("message_start"),
  message: z.object({ usage: reply.shape.usage }),
});

/** Its counts are the whole reply's so far; an input count rides along only where it moved. */
const delta = z.object({
  type: z.literal("message_delta"),
  delta: z.object({ stop_reason: z.string().nullable() }),
  usage: reply.shape.usage.extend({ input_tokens: count.nullish() }),
});

const textDelta = z.object({
  type: z.literal("content_block_delta"),
  delta: z.object({ type: z.literal("text_delta"), text: z.string() }),
});

const typed = z.object({ type: z.string() });

/** Data that is no JSON, or no event at all, is read as an error: the reply cannot be trusted. */
export const streamEventRead = (data: string): StreamEventRead => {
  const event = jsonAs(typed, data);
  if (event === undefined || event.type === "error") return { event: "error" };
  if (event.type === "message_stop") return { event: "stopped" };
  const text = jsonAs(textDelta, data);
  if (text !== undefined) return { event: "text", text: text.delta.text };
  const opened = jsonAs(started, data);
  if (opened !== undefined) return { event: "started", spent: spentOf(opened.message.usage) };
  const moved = jsonAs(delta, data);
  if (moved === undefined) return { event: "other" };
  const { input_tokens: tokensIn, ...usage } = moved.usage;
  return {
    event: "delta",
    stopReason: moved.delta.stop_reason,
    spent: spentOf({ ...usage, input_tokens: tokensIn ?? 0 }),
  };
};
