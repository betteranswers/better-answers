import { z } from "zod";

import {
  jsonAs,
  retryAfterMsOf,
  type TokensSpent,
  type WireRead,
  type WireRequest,
} from "./read.ts";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const MESSAGES_VERSION = "2023-06-01";

export type AnswerSchema = z.core.JSONSchema.JSONSchema;

export type MessagesCall = {
  readonly model: string;
  readonly key: string;
  readonly system: string;
  readonly prompt: string;
  readonly answerSchema: AnswerSchema;
  readonly tokensOut: number;
};

export type MessagesStreamCall = Omit<MessagesCall, "answerSchema">;

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

export const messagesStreamRequest = (call: MessagesStreamCall): WireRequest =>
  requestWith(call, { stream: true });

type MessagesRead = WireRead<string>;

const count = z.number().int().nonnegative();

const reply = z.object({
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

const TIER_SPEND_CAP = "enforced_spend_limit_reached";

const BILLED_OUT = ["You have reached your specified", "Your credit balance is too low"] as const;

const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([500, 504, 529]);

const BILLING = 402;
const RATE_LIMITED = 429;
const BAD_REQUEST = 400;
const ANSWERED = 200;

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

export const messagesRead = (
  status: number,
  text: string,
  retryAfter: string | null,
): MessagesRead => {
  if (status === ANSWERED) return answeredRead(text);
  if (status === RATE_LIMITED) return rateLimitedRead(text, retryAfter);
  if (status === BAD_REQUEST) return badRequestRead(text);
  if (status === BILLING) return { read: "spend-cap" };
  return UNAVAILABLE_STATUSES.has(status) ? { read: "unavailable" } : { read: "failed" };
};

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
