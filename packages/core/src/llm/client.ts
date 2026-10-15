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

/** Before the second attempt and the third. */
export const RETRY_WAITS_MS = [2_000, 8_000] as const;

/** A rate limit asking a longer wait than this is answered at once; the reservation would lapse. */
export const LONGEST_RETRY_WAIT_MS = 30_000;

/** How a reply is read, and the header it names its request by. */
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

/** The registry: the one wire shape each provider speaks. */
const SPEAKS = {
  anthropic: "messages",
  cloudflare: "decision",
} as const satisfies Record<SpokenProvider, WireShapeName>;

/** Everything one call needs, read in a transaction and carried out of it. */
export type ModelToCall = {
  readonly purpose: LlmPurpose;
  readonly modelChoiceId: string;
  readonly provider: SpokenProvider;
  readonly model: string;
  readonly key: ModelKey;
};

/** The wire shape the model is called through, which decides the call a caller builds for it. */
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

/** One call through the Messages shape: what to say, the answer's shape, and its reservation's size. */
export type ModelCall<T> = {
  readonly system: string;
  readonly prompt: string;
  readonly answer: z.ZodType<T>;
  /** Its `tokensOut` is each attempt's `max_tokens`, so no attempt spends past the reservation. */
  readonly most: CallSize;
  /** The whole call's wall clock, every attempt and wait inside it; none where it is absent. */
  readonly withinMs?: number;
};

/** One call through the decision shape. A decision model writes no text, so no output size is asked for. */
export type DecisionModelCall = {
  readonly state: string;
  readonly questions: Readonly<Record<string, NoulInstructions>>;
  /** The whole call's wall clock, every attempt and wait inside it; none where it is absent. */
  readonly withinMs?: number;
};

type Unanswered = "rate-limited" | "spend-cap" | "refused" | "failed";

/** Each attempt is one `CallSpent`, which settles the call's reservation as it stands. */
export type ModelOutcome<T> =
  | { readonly outcome: "answered"; readonly answer: T; readonly spent: readonly CallSpent[] }
  | { readonly outcome: Unanswered; readonly spent: readonly CallSpent[] };

type AttemptRead<Said = unknown> = WireRead<Said> | { readonly read: "timed-out" };

/** Never sent: the model speaks another shape, or the request is longer than its window. */
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

type ModelClientDoors = {
  /** The shape of `fetch`, so a test hands the client a fake at the wire. */
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

/** What reads an answered attempt as the answer the call asked for, or `undefined` for none. */
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

const lostTo = <Said>(signal: AbortSignal, otherwise: AttemptRead<Said>): AttemptRead<Said> =>
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

  const attemptOnce = async <Said>(
    shape: WireShape<Said>,
    request: WireRequest,
    timeoutMs: number,
  ): Promise<Attempted<Said>> => {
    const started = doors.clock.now().getTime();
    const signal = timeout(timeoutMs);
    const { url, ...init } = request;
    const replied = await attempt(() => doors.fetch(url, { ...init, signal }));
    if (!replied.ok) {
      // A failed connection may be tried again; a timed-out one may have been billed, so it is not.
      const read = lostTo<Said>(signal, { read: "unavailable" });
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
    const requestId = response.headers.get(shape.requestIdHeader);
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

  /** Logged as an attempt that was never made, so a judge that failed unsent says why. */
  const unsent = <T>(to: ModelToCall, read: Unsent): ModelOutcome<T> => {
    doors.log.info(
      {
        purpose: to.purpose,
        provider: to.provider,
        model: to.model,
        attempt: 0,
        status: null,
        read,
        seconds: 0,
        request_id: null,
      },
      "llm: a model call never sent",
    );
    return { outcome: "failed", spent: [] };
  };

  const called = async <Said, T>(
    to: ModelToCall,
    shape: WireShape<Said>,
    request: WireRequest,
    accept: Accept<Said, T>,
    withinMs: number | undefined,
  ): Promise<ModelOutcome<T>> => {
    const startedMs = doors.clock.now().getTime();
    const leftMs = (): number =>
      (withinMs ?? Number.POSITIVE_INFINITY) - (doors.clock.now().getTime() - startedMs);

    const from = async (
      attempted: number,
      before: readonly CallSpent[],
    ): Promise<ModelOutcome<T>> => {
      const tried = await attemptOnce(shape, request, Math.min(ATTEMPT_TIMEOUT_MS, leftMs()));
      logged(to, attempted, tried);
      const answered = answerOf(tried.read, accept);
      const spent = [...before, spentBy(tried, answered !== undefined)];
      if (answered !== undefined) return { outcome: "answered", answer: answered.answer, spent };
      const step = stepAfter(tried.read, attempted);
      if ("outcome" in step) return { outcome: step.outcome, spent };
      if (step.waitMs + SHORTEST_ATTEMPT_MS > leftMs()) {
        return { outcome: outOfTime(tried.read), spent };
      }
      await wait(step.waitMs);
      // A timer can fire late, so the room is measured again after it.
      if (leftMs() < SHORTEST_ATTEMPT_MS) return { outcome: outOfTime(tried.read), spent };
      return from(attempted + 1, spent);
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
    return called(to, MESSAGES, request, (text) => jsonAs(call.answer, text), call.withinMs);
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
    return called(to, DECISION, request, (said) => answers.safeParse(said).data, call.withinMs);
  };

  return { callModel, decide };
};
