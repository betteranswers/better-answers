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
  decisionRead,
  decisionRequest,
  fitsWindow,
  probabilitiesFor,
  type NoulInstructions,
  type Probabilities,
} from "./wire/decision.ts";
import { messagesRead, messagesRequest, type AnswerSchema } from "./wire/messages.ts";
import { jsonAs, type TokensSpent, type WireRead, type WireRequest } from "./wire/read.ts";

export const MAX_ATTEMPTS = 3;
export const ATTEMPT_TIMEOUT_MS = 2 * 60_000;

export const RETRY_WAITS_MS = [2_000, 8_000] as const;

/** A rate limit asking a longer wait than this is answered at once; the reservation would lapse. */
export const LONGEST_RETRY_WAIT_MS = 30_000;

type WireShape<Said> = {
  readonly read: (status: number, text: string, retryAfter: string | null) => WireRead<Said>;
  readonly requestIdHeader: string;
};

const MESSAGES: WireShape<string> = { read: messagesRead, requestIdHeader: "request-id" };
const DECISION: WireShape<unknown> = { read: decisionRead, requestIdHeader: "cf-ray" };

export type WireShapeName = "messages" | "decision";

/** The model providers a wire shape speaks; any other has no model to call. */
const SPOKEN = ["anthropic", "cloudflare"] as const satisfies readonly ModelProvider[];

type SpokenProvider = (typeof SPOKEN)[number];

const spoken = z.enum(SPOKEN);

const SPEAKS = {
  anthropic: "messages",
  cloudflare: "decision",
} as const satisfies Record<SpokenProvider, WireShapeName>;

export type ModelToCall = {
  readonly purpose: LlmPurpose;
  readonly modelChoiceId: string;
  readonly provider: SpokenProvider;
  readonly model: string;
  readonly key: ModelKey;
};

export const wireShapeOf = (to: ModelToCall): WireShapeName => SPEAKS[to.provider];

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

export type ModelCall<T> = {
  readonly system: string;
  readonly prompt: string;
  readonly answer: z.ZodType<T>;
  /** Its `tokensOut` is each attempt's `max_tokens`, so no attempt spends past the reservation. */
  readonly most: CallSize;
  /** The whole call's wall clock, every attempt and wait inside it; none where it is absent. */
  readonly withinMs?: number;
  /** The caller's: once it aborts, the attempt in flight ends and no other is made. */
  readonly signal?: AbortSignal;
};

/** One call through the decision shape. A decision model writes no text, so no output size is asked for. */
export type DecisionModelCall = {
  readonly state: string;
  readonly questions: Readonly<Record<string, NoulInstructions>>;
  /** The whole call's wall clock, every attempt and wait inside it; none where it is absent. */
  readonly withinMs?: number;
  /** The caller's: once it aborts, the attempt in flight ends and no other is made. */
  readonly signal?: AbortSignal;
};

export type Unanswered = "rate-limited" | "spend-cap" | "refused" | "failed";

/** Each attempt is one `CallSpent`, which settles the call's reservation as it stands. */
export type ModelOutcome<T> =
  | { readonly outcome: "answered"; readonly answer: T; readonly spent: readonly CallSpent[] }
  | { readonly outcome: Unanswered; readonly spent: readonly CallSpent[] };

export type AttemptRead<Said = unknown> =
  | WireRead<Said>
  | { readonly read: "timed-out" }
  | { readonly read: "abandoned" };

type Unsent = "another-shape" | "over-window";

/** Every field a log line about a call may hold: never a prompt, an answer, a body or a key. */
export type ModelAttemptLine = {
  readonly purpose: LlmPurpose;
  readonly provider: SpokenProvider;
  readonly model: string;
  readonly attempt: number;
  readonly status: number | null;
  readonly read: AttemptRead["read"] | Unsent;
  readonly seconds: number;
  readonly request_id: string | null;
};

export type ModelClientDoors = {
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly clock: Clock;
  readonly log: { readonly info: (line: ModelAttemptLine, message: string) => void };
  readonly wait?: (ms: number) => Promise<void>;
  readonly timeout?: (ms: number) => AbortSignal;
};

/** Each method calls a model of its own wire shape, and sends nothing to a model of the other. */
export type ModelClient = {
  readonly callModel: <T>(to: ModelToCall, call: ModelCall<T>) => Promise<ModelOutcome<T>>;
  readonly decide: (
    to: ModelToCall,
    call: DecisionModelCall,
  ) => Promise<ModelOutcome<Probabilities>>;
};

type Attempted<Said = unknown> = {
  readonly read: AttemptRead<Said>;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly seconds: number;
  /** Whether the request went out: one its caller ended before sending reached no provider. */
  readonly sent: boolean;
};

const NO_TOKENS: TokensSpent = { tokensIn: 0, tokensOut: 0 };

export const MS_PER_SECOND = 1000;

export const waitFor = (ms: number): Promise<void> =>
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

type Accept<Said, T> = (said: Said) => T | undefined;

const answerOf = <Said, T>(
  read: AttemptRead<Said>,
  accept: Accept<Said, T>,
): { readonly answer: T } | undefined => {
  if (read.read !== "answered") return undefined;
  const accepted = accept(read.said);
  return accepted === undefined ? undefined : { answer: accepted };
};

/** Shorter than this, a retry would be cut off before a reply could come, yet might be billed. */
const SHORTEST_ATTEMPT_MS = 10_000;

/** A retry the deadline leaves no room for ends the call as the attempt before it read. */
const outOfTime = (read: AttemptRead): Unanswered =>
  read.read === "rate-limited" ? "rate-limited" : "failed";

/**
 * How the call ends after an attempt, or `undefined` to try again. A wait the deadline leaves no
 * room for, or a caller who left during it, ends the call.
 */
export const afterAttempt = async (
  read: AttemptRead,
  attempted: number,
  leftMs: () => number,
  caller: AbortSignal | undefined,
  wait: (ms: number) => Promise<void>,
): Promise<Unanswered | undefined> => {
  const step = stepAfter(read, attempted);
  if ("outcome" in step) return step.outcome;
  if (step.waitMs + SHORTEST_ATTEMPT_MS > leftMs()) return outOfTime(read);
  await wait(step.waitMs);
  if (caller?.aborted === true) return "failed";
  // A timer can fire late, so the room is measured again after it.
  return leftMs() < SHORTEST_ATTEMPT_MS ? outOfTime(read) : undefined;
};

export const attemptSignal = (
  timedOut: AbortSignal,
  caller: AbortSignal | undefined,
): AbortSignal => (caller === undefined ? timedOut : AbortSignal.any([timedOut, caller]));

export const lostTo = <Said>(
  signal: AbortSignal,
  caller: AbortSignal | undefined,
  otherwise: AttemptRead<Said>,
): AttemptRead<Said> => {
  if (caller?.aborted === true) return { read: "abandoned" };
  return signal.aborted ? { read: "timed-out" } : otherwise;
};

export const attemptLine = (
  to: ModelToCall,
  attempted: number,
  tried: Pick<Attempted, "status" | "requestId" | "seconds"> & {
    readonly read: ModelAttemptLine["read"];
  },
): ModelAttemptLine => ({
  purpose: to.purpose,
  provider: to.provider,
  model: to.model,
  attempt: attempted,
  status: tried.status,
  read: tried.read,
  seconds: tried.seconds,
  request_id: tried.requestId,
});

/**
 * An attempt its caller ended after sending it may have been billed, so it counts at `cutAt`,
 * the size reserved for it.
 */
const spentBy = (tried: Attempted, answered: boolean, cutAt: TokensSpent): CallSpent => {
  const cut = tried.read.read === "abandoned" && tried.sent;
  return {
    ...("spent" in tried.read ? tried.read.spent : cut ? cutAt : NO_TOKENS),
    seconds: tried.seconds,
    outcome: answered ? "succeeded" : "failed",
  };
};

type Calling = {
  readonly withinMs: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly cutAt: TokensSpent;
};

export const openModelClient = (doors: ModelClientDoors): ModelClient => {
  const wait = doors.wait ?? waitFor;
  const timeout = doors.timeout ?? ((ms: number) => AbortSignal.timeout(ms));

  const secondsSince = (started: number): number =>
    (doors.clock.now().getTime() - started) / MS_PER_SECOND;

  const attemptOnce = async <Said>(
    shape: WireShape<Said>,
    request: WireRequest,
    timeoutMs: number,
    caller: AbortSignal | undefined,
  ): Promise<Attempted<Said>> => {
    const started = doors.clock.now().getTime();
    const sent = caller?.aborted !== true;
    const signal = attemptSignal(timeout(timeoutMs), caller);
    const { url, ...init } = request;
    const replied = await attempt(() => doors.fetch(url, { ...init, signal }));
    if (!replied.ok) {
      // A failed connection may be tried again; a timed-out one may have been billed, so it is not.
      const read = lostTo<Said>(signal, caller, { read: "unavailable" });
      return { read, status: null, requestId: null, seconds: secondsSince(started), sent };
    }
    const response = replied.value;
    const body = await attempt(() => response.text());
    const { status } = response;
    const retryAfter = response.headers.get("retry-after");
    // A body lost after its status is read by the status alone, so a billed 200 is not tried again.
    const read = body.ok
      ? shape.read(status, body.value, retryAfter)
      : lostTo(signal, caller, shape.read(status, "", retryAfter));
    const requestId = response.headers.get(shape.requestIdHeader);
    return { read, status, requestId, seconds: secondsSince(started), sent };
  };

  const logged = (to: ModelToCall, attempted: number, tried: Attempted): void => {
    doors.log.info(
      attemptLine(to, attempted, { ...tried, read: tried.read.read }),
      "llm: a model call's attempt",
    );
  };

  /** Logged as an attempt that was never made, so a judge that failed unsent says why. */
  const unsent = <T>(to: ModelToCall, read: Unsent): ModelOutcome<T> => {
    doors.log.info(
      attemptLine(to, 0, { status: null, read, seconds: 0, requestId: null }),
      "llm: a model call never sent",
    );
    return { outcome: "failed", spent: [] };
  };

  const called = async <Said, T>(
    to: ModelToCall,
    shape: WireShape<Said>,
    request: WireRequest,
    accept: Accept<Said, T>,
    { withinMs, signal, cutAt }: Calling,
  ): Promise<ModelOutcome<T>> => {
    const startedMs = doors.clock.now().getTime();
    const leftMs = (): number =>
      (withinMs ?? Number.POSITIVE_INFINITY) - (doors.clock.now().getTime() - startedMs);

    const from = async (
      attempted: number,
      before: readonly CallSpent[],
    ): Promise<ModelOutcome<T>> => {
      const timeoutMs = Math.min(ATTEMPT_TIMEOUT_MS, leftMs());
      const tried = await attemptOnce(shape, request, timeoutMs, signal);
      logged(to, attempted, tried);
      const answered = answerOf(tried.read, accept);
      const spent = [...before, spentBy(tried, answered !== undefined, cutAt)];
      if (answered !== undefined) return { outcome: "answered", answer: answered.answer, spent };
      const ended = await afterAttempt(tried.read, attempted, leftMs, signal, wait);
      return ended === undefined ? from(attempted + 1, spent) : { outcome: ended, spent };
    };

    return from(1, []);
  };

  const callModel = async <T>(to: ModelToCall, call: ModelCall<T>): Promise<ModelOutcome<T>> => {
    if (SPEAKS[to.provider] !== "messages") return unsent(to, "another-shape");
    const request = messagesRequest({
      model: to.model,
      key: to.key.reveal(),
      system: call.system,
      prompt: call.prompt,
      answerSchema: answerSchemaOf(call.answer),
      tokensOut: call.most.tokensOut,
    });
    return called(to, MESSAGES, request, (text) => jsonAs(call.answer, text), {
      withinMs: call.withinMs,
      signal: call.signal,
      cutAt: call.most,
    });
  };

  /** A request longer than the model's window is never sent: the provider would cut it unsaid. */
  const decide = async (
    to: ModelToCall,
    call: DecisionModelCall,
  ): Promise<ModelOutcome<Probabilities>> => {
    if (SPEAKS[to.provider] !== "decision") return unsent(to, "another-shape");
    const request = decisionRequest({
      model: to.model,
      key: to.key.reveal(),
      state: call.state,
      questions: call.questions,
    });
    if (!fitsWindow(to.model, request.body)) return unsent(to, "over-window");
    const answers = probabilitiesFor(Object.keys(call.questions));
    // A decision call reserves no output, and nothing marks what a cut one was billed.
    return called(to, DECISION, request, (said) => answers.safeParse(said).data, {
      withinMs: call.withinMs,
      signal: call.signal,
      cutAt: NO_TOKENS,
    });
  };

  return { callModel, decide };
};
