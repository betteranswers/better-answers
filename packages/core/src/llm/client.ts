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

export const LONGEST_RETRY_WAIT_MS = 30_000;

type WireShape<Said> = {
  readonly read: (status: number, text: string, retryAfter: string | null) => WireRead<Said>;
  readonly requestIdHeader: string;
};

const MESSAGES: WireShape<string> = { read: messagesRead, requestIdHeader: "request-id" };
const DECISION: WireShape<unknown> = { read: decisionRead, requestIdHeader: "cf-ray" };

export type WireShapeName = "messages" | "decision";

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

const spokenChoice = z.object({ id: z.string(), provider: spoken, model: z.string() });

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
  readonly sent: boolean;
};

const NO_TOKENS: TokensSpent = { tokensIn: 0, tokensOut: 0 };

export const MS_PER_SECOND = 1000;

export const waitFor = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

const SHORTEST_ATTEMPT_MS = 10_000;

const outOfTime = (read: AttemptRead): Unanswered =>
  read.read === "rate-limited" ? "rate-limited" : "failed";

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
      const read = lostTo<Said>(signal, caller, { read: "unavailable" });
      return { read, status: null, requestId: null, seconds: secondsSince(started), sent };
    }
    const response = replied.value;
    const body = await attempt(() => response.text());
    const { status } = response;
    const retryAfter = response.headers.get("retry-after");
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
