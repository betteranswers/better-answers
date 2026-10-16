import { z } from "zod";

import { jsonAs, retryAfterMsOf, type WireRead, type WireRequest } from "./read.ts";

const ACCOUNTS_URL = "https://api.cloudflare.com/client/v4/accounts";
const MODELS_PATH = "ai/run/@cf/cloudflare";

/** Each model's window in tokens, as its vendor publishes it; a model absent here is never sent. */
const WINDOW_TOKENS: ReadonlyMap<string, number> = new Map([
  ["clef", 65_536],
  ["clef-flash", 24_576],
]);

/**
 * English runs near four bytes a token. The provider cuts an overlong state unsaid, so the count
 * leans high.
 */
const BYTES_PER_TOKEN = 3;

/** The account's id, a colon, then an API token: Cloudflare names an account in the URL. */
const WORKERS_AI_KEY = /^[0-9a-f]{32}:[A-Za-z0-9_-]+$/;

export const isWorkersAiKey = (key: string): boolean => WORKERS_AI_KEY.test(key);

/** A true-or-false question: what to ask, and the data it asks about, each under its own name. */
export type NoulInstructions = Readonly<Record<string, string>>;

/** One attempt as Workers AI takes it: the state, and one true-or-false question per id. */
export type DecisionCall = {
  readonly model: string;
  readonly key: string;
  readonly state: string;
  readonly questions: Readonly<Record<string, NoulInstructions>>;
};

/** The account's id is the key up to its first colon, a form the key was refused without. */
export const decisionRequest = (call: DecisionCall): WireRequest => {
  const colon = call.key.indexOf(":");
  return {
    url: `${ACCOUNTS_URL}/${call.key.slice(0, colon)}/${MODELS_PATH}/${call.model}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${call.key.slice(colon + 1)}`,
    },
    body: JSON.stringify({
      model: call.model,
      state: call.state,
      questions: Object.fromEntries(
        Object.entries(call.questions).map(([id, instructions]) => [
          id,
          { type: "noul", instructions },
        ]),
      ),
    }),
  };
};

const utf8 = new TextEncoder();

/** Whether a request's body fits its model's window; one with no published window never does. */
export const fitsWindow = (model: string, body: string): boolean =>
  Math.ceil(utf8.encode(body).length / BYTES_PER_TOKEN) <= (WINDOW_TOKENS.get(model) ?? 0);

export type Probabilities = Readonly<Record<string, number>>;

const noulAnswer = z
  .object({ type: z.literal("noul"), noul: z.number().min(0).max(1) })
  .transform(({ noul }) => noul);

/** One answer required under each id asked, so a reply that skips a question is no answer. */
export const probabilitiesFor = (ids: readonly string[]): z.ZodType<Probabilities> =>
  z.strictObject(Object.fromEntries(ids.map((id) => [id, noulAnswer])));

const count = z.number().int().nonnegative();

const reply = z.object({
  success: z.literal(true),
  result: z.object({
    answers: z.unknown(),
    usage: z.object({ input_tokens: count, output_tokens: count }),
  }),
});

const errorReply = z.object({ errors: z.array(z.object({ code: z.number() })) });

/** The free plan's daily allocation spent: a 429 that waiting through a call does not lift. */
const DAILY_ALLOCATION_USED = 3036;

/** The provider's own faults, which another attempt may get past. */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504]);

const RATE_LIMITED = 429;
const ANSWERED = 200;

const answeredRead = (text: string): WireRead<unknown> => {
  const parsed = jsonAs(reply, text);
  if (parsed === undefined) return { read: "failed" };
  const { answers, usage } = parsed.result;
  return {
    read: "answered",
    said: answers,
    spent: { tokensIn: usage.input_tokens, tokensOut: usage.output_tokens },
  };
};

const rateLimitedRead = (text: string, retryAfter: string | null): WireRead<unknown> =>
  jsonAs(errorReply, text)?.errors.some(({ code }) => code === DAILY_ALLOCATION_USED) === true
    ? { read: "spend-cap" }
    : { read: "rate-limited", retryAfterMs: retryAfterMsOf(retryAfter) };

export const decisionRead = (
  status: number,
  text: string,
  retryAfter: string | null,
): WireRead<unknown> => {
  if (status === ANSWERED) return answeredRead(text);
  if (status === RATE_LIMITED) return rateLimitedRead(text, retryAfter);
  return UNAVAILABLE_STATUSES.has(status) ? { read: "unavailable" } : { read: "failed" };
};
