import { z } from "zod";

import { jsonAs, retryAfterMsOf, type WireRead, type WireRequest } from "./read.ts";

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

/**
 * No `thinking` and no sampling field: a model choice may name a model that refuses either, and
 * each model's default stands.
 */
export const messagesRequest = (call: MessagesCall): WireRequest => ({
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
    output_config: { format: { type: "json_schema", schema: call.answerSchema } },
  }),
});

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
