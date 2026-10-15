import { z } from "zod";

import type { ModelProvider } from "@better-answers/schema";

import {
  attempt,
  attemptResult,
  ok,
  type Clock,
  type OpenEnvelopeRefusal,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { Credentials, ModelKey } from "./credentials.ts";
import type { LlmPurpose } from "./index.ts";
import type { CallSize, CallSpent } from "./spend.ts";
import {
  jsonAs,
  messagesRead,
  messagesRequest,
  type AnswerSchema,
  type MessagesCall,
  type MessagesRead,
  type MessagesRequest,
  type TokensSpent,
} from "./wire/messages.ts";

export const MAX_ATTEMPTS = 3;
export const ATTEMPT_TIMEOUT_MS = 2 * 60_000;

/** Before the second attempt and the third. */
export const RETRY_WAITS_MS = [2_000, 8_000] as const;

/** A rate limit asking a longer wait than this is answered at once; the reservation would lapse. */
export const LONGEST_RETRY_WAIT_MS = 30_000;

type WireShape = {
  readonly request: (call: MessagesCall) => MessagesRequest;
  readonly read: (status: number, text: string, retryAfter: string | null) => MessagesRead;
};

/** The model providers a wire shape speaks; any other has no model to call. */
const SPOKEN = ["anthropic"] as const satisfies readonly ModelProvider[];

type SpokenProvider = (typeof SPOKEN)[number];

const spoken = z.enum(SPOKEN);

const WIRE_SHAPES = {
  anthropic: { request: messagesRequest, read: messagesRead },
} as const satisfies Record<SpokenProvider, WireShape>;

/** Everything one call needs, read in a transaction and carried out of it. */
export type ModelToCall = {
  readonly purpose: LlmPurpose;
  readonly modelChoiceId: string;
  readonly provider: SpokenProvider;
  readonly model: string;
  readonly key: ModelKey;
};

/** A row naming a provider no wire shape speaks is no model to call. */
const spokenChoice = z.object({ id: z.string(), provider: spoken, model: z.string() });

/**
 * The model the workspace chose for `purpose`, with its key; `undefined` when there is none to
 * call: no choice, no key, or a provider no wire shape speaks.
 */
export const resolveModel = async (
  asker: UserPrincipal,
  tx: Tx,
  credentials: Credentials,
  purpose: LlmPurpose,
): Promise<Result<ModelToCall | undefined, OpenEnvelopeRefusal | Error>> =>
  attemptResult(async (): Promise<Result<ModelToCall | undefined, OpenEnvelopeRefusal>> => {
    const found = await tx.query(
      "SELECT id, provider, model FROM model_choice WHERE workspace_id = $1 AND purpose = $2",
      [asker.workspaceId, purpose],
    );
    const choice = spokenChoice.safeParse(found.rows[0]);
    if (!choice.success) return ok(undefined);
    const { id, provider, model } = choice.data;
    const key = await credentials.readModelKey(tx, provider);
    if (!key.ok || key.value === undefined) return key.ok ? ok(undefined) : key;
    return ok({ purpose, modelChoiceId: id, provider, model, key: key.value });
  });

/** One call: what to say, the answer's shape, and the size its reservation holds. */
export type ModelCall<T> = {
  readonly system: string;
  readonly prompt: string;
  readonly answer: z.ZodType<T>;
  readonly most: CallSize;
};

type Unanswered = "rate-limited" | "spend-cap" | "refused" | "failed";

/** Each attempt is one `CallSpent`, which settles the call's reservation as it stands. */
export type ModelOutcome<T> =
  | { readonly outcome: "answered"; readonly answer: T; readonly spent: readonly CallSpent[] }
  | { readonly outcome: Unanswered; readonly spent: readonly CallSpent[] };

type AttemptRead = MessagesRead | { readonly read: "timed-out" };

/** Every field a log line about a call may hold: never a prompt, an answer, a body or a key. */
export type ModelAttemptLine = {
  readonly purpose: LlmPurpose;
  readonly provider: SpokenProvider;
  readonly model: string;
  readonly attempt: number;
  readonly status: number | null;
  readonly read: AttemptRead["read"];
  readonly seconds: number;
  readonly request_id: string | null;
};

type ModelClientDoors = {
  /** The shape of `fetch`, so a test hands the client a fake at the wire. */
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly clock: Clock;
  readonly log: { readonly info: (line: ModelAttemptLine, message: string) => void };
  readonly wait?: (ms: number) => Promise<void>;
  readonly timeout?: (ms: number) => AbortSignal;
};

export type ModelClient = {
  readonly callModel: <T>(to: ModelToCall, call: ModelCall<T>) => Promise<ModelOutcome<T>>;
};

type Attempted = {
  readonly read: AttemptRead;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly seconds: number;
};

const NO_TOKENS: TokensSpent = { tokensIn: 0, tokensOut: 0 };

const MS_PER_SECOND = 1000;

const waitFor = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A provider's JSON schema reader takes no `$schema` key, which zod writes. */
const answerSchemaOf = (answer: z.ZodType): AnswerSchema => {
  const { $schema: _written, ...schema } = z.toJSONSchema(answer);
  return schema;
};

type Step = { readonly waitMs: number } | { readonly outcome: Unanswered };

const waitBefore = (next: number, retryAfterMs = 0): number =>
  Math.max(RETRY_WAITS_MS[next - 2] ?? 0, retryAfterMs);

const afterRateLimit = (retryAfterMs: number | undefined, attempted: number): Step => {
  const asked = retryAfterMs ?? 0;
  return attempted < MAX_ATTEMPTS && asked <= LONGEST_RETRY_WAIT_MS
    ? { waitMs: waitBefore(attempted + 1, asked) }
    : { outcome: "rate-limited" };
};

/** Only an attempt that spent nothing is tried again, so a call never spends past its reservation. */
const stepAfter = (read: AttemptRead, attempted: number): Step => {
  if (read.read === "rate-limited") return afterRateLimit(read.retryAfterMs, attempted);
  if (read.read === "unavailable") {
    return attempted < MAX_ATTEMPTS ? { waitMs: waitBefore(attempted + 1) } : { outcome: "failed" };
  }
  if (read.read === "spend-cap" || read.read === "refused") return { outcome: read.read };
  return { outcome: "failed" };
};

/** The answer, when the attempt answered with JSON of the shape the call asked for. */
const answerOf = <T>(
  read: AttemptRead,
  answer: z.ZodType<T>,
): { readonly answer: T } | undefined => {
  if (read.read !== "answered") return undefined;
  const parsed = jsonAs(answer, read.text);
  return parsed === undefined ? undefined : { answer: parsed };
};

const lostTo = (signal: AbortSignal, otherwise: AttemptRead): AttemptRead =>
  signal.aborted ? { read: "timed-out" } : otherwise;

const spentBy = (tried: Attempted, answered: boolean): CallSpent => ({
  ...("spent" in tried.read ? tried.read.spent : NO_TOKENS),
  seconds: tried.seconds,
  outcome: answered ? "succeeded" : "failed",
});

export const openModelClient = (doors: ModelClientDoors): ModelClient => {
  const wait = doors.wait ?? waitFor;
  const timeout = doors.timeout ?? ((ms: number) => AbortSignal.timeout(ms));

  const secondsSince = (started: number): number =>
    (doors.clock.now().getTime() - started) / MS_PER_SECOND;

  const attemptOnce = async (shape: WireShape, request: MessagesRequest): Promise<Attempted> => {
    const started = doors.clock.now().getTime();
    const signal = timeout(ATTEMPT_TIMEOUT_MS);
    const { url, ...init } = request;
    const replied = await attempt(() => doors.fetch(url, { ...init, signal }));
    if (!replied.ok) {
      // A failed connection may be tried again; a timed-out one may have been billed, so it is not.
      const read = lostTo(signal, { read: "unavailable" });
      return { read, status: null, requestId: null, seconds: secondsSince(started) };
    }
    const response = replied.value;
    const body = await attempt(() => response.text());
    const { status } = response;
    const retryAfter = response.headers.get("retry-after");
    // A body lost after its status is read by the status alone, so a billed 200 is not tried again.
    const read = body.ok
      ? shape.read(status, body.value, retryAfter)
      : lostTo(signal, shape.read(status, "", retryAfter));
    const requestId = response.headers.get("request-id");
    return { read, status, requestId, seconds: secondsSince(started) };
  };

  const logged = (to: ModelToCall, attempted: number, tried: Attempted): void => {
    doors.log.info(
      {
        purpose: to.purpose,
        provider: to.provider,
        model: to.model,
        attempt: attempted,
        status: tried.status,
        read: tried.read.read,
        seconds: tried.seconds,
        request_id: tried.requestId,
      },
      "llm: a model call's attempt",
    );
  };

  const callModel = async <T>(to: ModelToCall, call: ModelCall<T>): Promise<ModelOutcome<T>> => {
    const shape = WIRE_SHAPES[to.provider];
    const request = shape.request({
      model: to.model,
      key: to.key.reveal(),
      system: call.system,
      prompt: call.prompt,
      answerSchema: answerSchemaOf(call.answer),
      tokensOut: call.most.tokensOut,
    });

    const from = async (
      attempted: number,
      before: readonly CallSpent[],
    ): Promise<ModelOutcome<T>> => {
      const tried = await attemptOnce(shape, request);
      logged(to, attempted, tried);
      const answered = answerOf(tried.read, call.answer);
      const spent = [...before, spentBy(tried, answered !== undefined)];
      if (answered !== undefined) return { outcome: "answered", answer: answered.answer, spent };
      const step = stepAfter(tried.read, attempted);
      if ("outcome" in step) return { outcome: step.outcome, spent };
      await wait(step.waitMs);
      return from(attempted + 1, spent);
    };

    return from(1, []);
  };

  return { callModel };
};
