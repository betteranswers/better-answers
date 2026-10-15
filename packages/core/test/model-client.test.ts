import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import {
  ATTEMPT_TIMEOUT_MS,
  LONGEST_RETRY_WAIT_MS,
  MAX_ATTEMPTS,
  openCredentials,
  openModelClient,
  openModelKeySetting,
  RESERVATION_LIFETIME_MS,
  resolveModel,
  RETRY_WAITS_MS,
  type ModelAttemptLine,
  type ModelCall,
  type ModelToCall,
} from "../src/llm/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { setModelChoice, setModelKey, setModelPrice } from "../src/workspaces/index.ts";
import { bootstrap, provisionedWorkspace } from "./platform.ts";
import { answered, postgresForSuite, readingAs, seedingWith } from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

const db = postgresForSuite();

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };

/** Invented: it seals nothing outside this file. */
const ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_byte, index) => index);
const A_KEY = "sk-test-u12-invented-key-0001";

const SONNET = "claude-sonnet-5-5";
const NOW = new Date("2026-10-15T09:00:00.000Z");

const QUESTION = "How long are audit logs kept?";
const SYSTEM = "Answer yes or no for each candidate.";

const verdicts = z.object({ fits: z.array(z.object({ iri: z.string(), fits: z.boolean() })) });

const A_CALL: ModelCall<z.output<typeof verdicts>> = {
  system: SYSTEM,
  prompt: QUESTION,
  answer: verdicts,
  most: { tokensIn: 40_000, tokensOut: 2_000 },
};

const TO_SONNET: ModelToCall = {
  purpose: "judging",
  modelChoiceId: "judge-1",
  provider: "anthropic",
  model: SONNET,
  key: { reveal: () => A_KEY },
};

const THE_ANSWER = '{"fits":[{"iri":"https://acme.example/answer/retention","fits":true}]}';

const reply = (
  text: string,
  stopReason = "end_turn",
  usage: Record<string, number> = { input_tokens: 1580, output_tokens: 96 },
) =>
  JSON.stringify({
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: SONNET,
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage,
  });

const errorReply = (type: string, message: string, details?: Record<string, string>) =>
  JSON.stringify({ type: "error", error: { type, message, details }, request_id: "req_01" });

type Sent = { readonly url: string; readonly init: RequestInit; readonly body: string };

type Reply = {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
};

type Answer = Reply | "hang" | "unreachable";

const sentOf = (input: string | URL | Request, init: RequestInit = {}): Sent => ({
  url: input instanceof Request ? input.url : input.toString(),
  init,
  body: typeof init.body === "string" ? init.body : "",
});

/** Past its replies the wire answers a teapot, so an attempt too many shows in what was spent. */
const NO_MORE: Reply = { status: 418, body: "" };

/** A hung attempt rejects once its timeout has fired, as `fetch` does on an aborted signal. */
const answering = (next: Answer, signal: AbortSignal | null | undefined) => {
  if (next === "unreachable") throw new TypeError("fetch failed");
  if (next !== "hang") {
    return new Response(next.body, { status: next.status, headers: next.headers ?? {} });
  }
  if (signal?.aborted === true) throw new DOMException("timed out", "TimeoutError");
  throw new Error("a hung attempt was sent with no timeout fired");
};

/** A fake at the wire: it keeps what it is sent and answers each attempt in turn. */
const theWire = (...replies: readonly Answer[]) => {
  const sent: Sent[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push(sentOf(input, init));
    return answering(replies[sent.length - 1] ?? NO_MORE, init?.signal);
  };
  return { sent, fetch };
};

type Wire = ReturnType<typeof theWire>;

const clientOn = (
  wire: Wire,
  options: { readonly timedOut?: boolean; readonly secondsPerRead?: number } = {},
) => {
  const lines: { line: ModelAttemptLine; message: string }[] = [];
  const waits: number[] = [];
  const timeouts: number[] = [];
  let reads = 0;
  const client = openModelClient({
    fetch: wire.fetch,
    clock: {
      now: () => new Date(NOW.getTime() + reads++ * 1000 * (options.secondsPerRead ?? 0)),
    },
    log: { info: (line, message) => lines.push({ line, message }) },
    wait: async (ms) => {
      waits.push(ms);
      if (waits.length >= MAX_ATTEMPTS)
        throw new Error("the call waited more than its attempts allow");
    },
    timeout: (ms) => {
      timeouts.push(ms);
      return options.timedOut === true ? AbortSignal.abort() : new AbortController().signal;
    },
  });
  return { client, lines, waits, timeouts };
};

const calling = (wire: Wire, options?: Parameters<typeof clientOn>[1]) =>
  clientOn(wire, options).client.callModel(TO_SONNET, A_CALL);

const RATE_LIMITED: Reply = {
  status: 429,
  body: errorReply("rate_limit_error", "Number of request tokens has exceeded your limit."),
  headers: { "retry-after": "5" },
};

const OVERLOADED: Reply = { status: 529, body: errorReply("overloaded_error", "Overloaded") };

const ANSWERED: Reply = { status: 200, body: reply(THE_ANSWER) };

const NOTHING_SPENT = { tokensIn: 0, tokensOut: 0, seconds: 0, outcome: "failed" };

describe("the Messages shape", () => {
  it("sends the model, its key and the Messages body", async () => {
    const wire = theWire(ANSWERED);

    await calling(wire);

    expect(wire.sent).toHaveLength(1);
    const [sent] = wire.sent;
    expect(sent?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent?.init.method).toBe("POST");
    expect(sent?.init.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": A_KEY,
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(sent?.body ?? "")).toEqual({
      model: SONNET,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: QUESTION }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              fits: {
                type: "array",
                items: {
                  type: "object",
                  properties: { iri: { type: "string" }, fits: { type: "boolean" } },
                  required: ["iri", "fits"],
                  additionalProperties: false,
                },
              },
            },
            required: ["fits"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it("answers with the parsed answer and the tokens it spent", async () => {
    const called = await calling(theWire(ANSWERED), { secondsPerRead: 1.5 });

    expect(called).toEqual({
      outcome: "answered",
      answer: { fits: [{ iri: "https://acme.example/answer/retention", fits: true }] },
      spent: [{ tokensIn: 1580, tokensOut: 96, seconds: 1.5, outcome: "succeeded" }],
    });
  });

  it("counts cached input tokens as tokens in", async () => {
    const usage = {
      input_tokens: 50,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 200_000,
      output_tokens: 96,
    };

    const called = await calling(
      theWire({ status: 200, body: reply(THE_ANSWER, "end_turn", usage) }),
    );

    expect(called.spent).toEqual([
      { tokensIn: 201_050, tokensOut: 96, seconds: 0, outcome: "succeeded" },
    ]);
  });

  it("joins the text blocks and passes over the thinking ones", async () => {
    const body = JSON.stringify({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: '{"fits":[' },
        { type: "text", text: "]}" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 4 },
    });

    const called = await calling(theWire({ status: 200, body }));

    expect(called).toMatchObject({ outcome: "answered", answer: { fits: [] } });
  });

  it("tells a provider's spend cap apart from a rate limit", async () => {
    const tierCap: Reply = {
      status: 429,
      body: errorReply("rate_limit_error", "You have reached your API usage limits.", {
        error_code: "enforced_spend_limit_reached",
      }),
    };
    const ownLimit: Reply = {
      status: 400,
      body: errorReply(
        "invalid_request_error",
        "You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.",
      ),
    };
    const billing: Reply = { status: 402, body: errorReply("billing_error", "Payment failed.") };
    const limited = { ...RATE_LIMITED, headers: { "retry-after": "60" } };

    expect((await calling(theWire(tierCap))).outcome).toBe("spend-cap");
    expect((await calling(theWire(ownLimit))).outcome).toBe("spend-cap");
    expect((await calling(theWire(billing))).outcome).toBe("spend-cap");
    expect((await calling(theWire(limited))).outcome).toBe("rate-limited");
  });

  it("fails a bad request that names no spend limit, once", async () => {
    const wire = theWire({
      status: 400,
      body: errorReply("invalid_request_error", "max_tokens: must be at most 128000"),
    });

    expect(await calling(wire)).toEqual({ outcome: "failed", spent: [NOTHING_SPENT] });
    expect(wire.sent).toHaveLength(1);
  });

  it("fails a reply that is not the shape's JSON", async () => {
    const notJson = await calling(theWire({ status: 200, body: "<html>Bad gateway</html>" }));
    const notTheShape = await calling(
      theWire({ status: 200, body: JSON.stringify({ content: "yes", usage: {} }) }),
    );

    expect(notJson).toEqual({ outcome: "failed", spent: [NOTHING_SPENT] });
    expect(notTheShape).toEqual({ outcome: "failed", spent: [NOTHING_SPENT] });
  });

  it("fails an answer of the wrong shape, keeping its tokens", async () => {
    const called = await calling(theWire({ status: 200, body: reply('{"fits":"yes"}') }));

    expect(called).toEqual({
      outcome: "failed",
      spent: [{ tokensIn: 1580, tokensOut: 96, seconds: 0, outcome: "failed" }],
    });
  });

  it("answers a refusal with the tokens it was billed", async () => {
    const called = await calling(theWire({ status: 200, body: reply("I can't help.", "refusal") }));

    expect(called).toEqual({
      outcome: "refused",
      spent: [{ tokensIn: 1580, tokensOut: 96, seconds: 0, outcome: "failed" }],
    });
  });

  it("fails an answer cut off at its token limit, once", async () => {
    const wire = theWire({ status: 200, body: reply('{"fits":[]}', "max_tokens") });

    expect(await calling(wire)).toEqual({
      outcome: "failed",
      spent: [{ tokensIn: 1580, tokensOut: 96, seconds: 0, outcome: "failed" }],
    });
    expect(wire.sent).toHaveLength(1);
  });

  it("fails a timed-out call once, recording no tokens", async () => {
    const wire = theWire("hang");

    const { client, timeouts } = clientOn(wire, { timedOut: true });
    const called = await client.callModel(TO_SONNET, A_CALL);

    expect(called).toEqual({ outcome: "failed", spent: [NOTHING_SPENT] });
    expect(wire.sent).toHaveLength(1);
    expect(timeouts).toEqual([120_000]);
  });
});

describe("a model call's attempts", () => {
  it("tries a rate-limited call again after the wait asked", async () => {
    const wire = theWire(RATE_LIMITED, ANSWERED);
    const { client, waits } = clientOn(wire);

    const called = await client.callModel(TO_SONNET, A_CALL);

    expect(called.outcome).toBe("answered");
    expect(called.spent).toEqual([
      NOTHING_SPENT,
      { tokensIn: 1580, tokensOut: 96, seconds: 0, outcome: "succeeded" },
    ]);
    expect(waits).toEqual([5000]);
  });

  it("waits its backoff when longer than the wait asked", async () => {
    const wire = theWire(
      { ...RATE_LIMITED, headers: { "retry-after": "1" } },
      OVERLOADED,
      ANSWERED,
    );
    const { client, waits } = clientOn(wire);

    await client.callModel(TO_SONNET, A_CALL);

    expect(waits).toEqual([2000, 8000]);
  });

  it("answers rate limited when the wait asked is too long", async () => {
    const wire = theWire({ ...RATE_LIMITED, headers: { "retry-after": "31" } });
    const { client, waits } = clientOn(wire);

    expect(await client.callModel(TO_SONNET, A_CALL)).toEqual({
      outcome: "rate-limited",
      spent: [NOTHING_SPENT],
    });
    expect(waits).toEqual([]);
  });

  it("waits up to thirty seconds a rate limit asks", async () => {
    const wire = theWire({ ...RATE_LIMITED, headers: { "retry-after": "30" } }, ANSWERED);
    const { client, waits } = clientOn(wire);

    expect((await client.callModel(TO_SONNET, A_CALL)).outcome).toBe("answered");
    expect(waits).toEqual([30_000]);
  });

  it("answers rate limited after three limited attempts", async () => {
    const wire = theWire(RATE_LIMITED, RATE_LIMITED, RATE_LIMITED);
    const { client, waits } = clientOn(wire);

    expect(await client.callModel(TO_SONNET, A_CALL)).toEqual({
      outcome: "rate-limited",
      spent: [NOTHING_SPENT, NOTHING_SPENT, NOTHING_SPENT],
    });
    expect(waits).toEqual([5000, 8000]);
  });

  it("reads a retry-after that is not whole seconds as none", async () => {
    const wire = theWire({ ...RATE_LIMITED, headers: { "retry-after": "12.5" } }, ANSWERED);
    const { client, waits } = clientOn(wire);

    await client.callModel(TO_SONNET, A_CALL);

    expect(waits).toEqual([2000]);
  });

  it("tries an unavailable provider three times, then fails", async () => {
    const wire = theWire(
      OVERLOADED,
      { status: 500, body: errorReply("api_error", "Internal error") },
      "unreachable",
    );
    const { client, waits } = clientOn(wire);

    expect(await client.callModel(TO_SONNET, A_CALL)).toEqual({
      outcome: "failed",
      spent: [NOTHING_SPENT, NOTHING_SPENT, NOTHING_SPENT],
    });
    expect(waits).toEqual([2000, 8000]);
  });

  it("tries a provider timeout again", async () => {
    const wire = theWire({ status: 504, body: errorReply("timeout_error", "Timed out") }, ANSWERED);

    expect((await calling(wire)).outcome).toBe("answered");
  });

  it("never tries a spend cap or a refusal again", async () => {
    const capped = theWire({ status: 402, body: errorReply("billing_error", "Payment failed.") });
    const refused = theWire({ status: 200, body: reply("No.", "refusal") });

    await calling(capped);
    await calling(refused);

    expect([capped.sent.length, refused.sent.length]).toEqual([1, 1]);
  });

  it("fits every attempt and wait inside a reservation's life", () => {
    const longestCallMs =
      MAX_ATTEMPTS * ATTEMPT_TIMEOUT_MS + (MAX_ATTEMPTS - 1) * LONGEST_RETRY_WAIT_MS;

    expect(longestCallMs).toBe(7 * 60_000);
    expect(RETRY_WAITS_MS.every((ms) => ms <= LONGEST_RETRY_WAIT_MS)).toBe(true);
    expect(RESERVATION_LIFETIME_MS - longestCallMs).toBeGreaterThanOrEqual(3 * 60_000);
  });
});

describe("what a model call logs", () => {
  it("logs no request body and no response body", async () => {
    const wire = theWire(RATE_LIMITED, {
      ...ANSWERED,
      headers: { "request-id": "req_018EeWyXxfu5pfWkrYcMdjWG" },
    });
    const { client, lines } = clientOn(wire);

    await client.callModel(TO_SONNET, A_CALL);

    const logged = JSON.stringify(lines);
    for (const held of [QUESTION, SYSTEM, A_KEY, "retention", "Number of request tokens"]) {
      expect(logged).not.toContain(held);
    }
    expect(lines).toEqual([
      {
        line: {
          purpose: "judging",
          provider: "anthropic",
          model: SONNET,
          attempt: 1,
          status: 429,
          read: "rate-limited",
          seconds: 0,
          request_id: null,
        },
        message: "llm: a model call's attempt",
      },
      {
        line: {
          purpose: "judging",
          provider: "anthropic",
          model: SONNET,
          attempt: 2,
          status: 200,
          read: "answered",
          seconds: 0,
          request_id: "req_018EeWyXxfu5pfWkrYcMdjWG",
        },
        message: "llm: a model call's attempt",
      },
    ]);
  });

  it("logs a timed-out attempt with no status", async () => {
    const { client, lines } = clientOn(theWire("hang"), { timedOut: true });

    await client.callModel(TO_SONNET, A_CALL);

    expect(lines.map(({ line }) => [line.status, line.read])).toEqual([[null, "timed-out"]]);
  });

  it("logs what each attempt's reply read as", async () => {
    const reads = async (...replies: readonly Answer[]) => {
      const { client, lines } = clientOn(theWire(...replies));
      await client.callModel(TO_SONNET, A_CALL);
      return lines.map(({ line }) => [line.status, line.read]);
    };

    expect(await reads({ status: 404, body: errorReply("not_found_error", "model: x") })).toEqual([
      [404, "failed"],
    ]);
    expect(await reads({ status: 200, body: "not json" })).toEqual([[200, "failed"]]);
    expect(await reads({ status: 400, body: errorReply("invalid_request_error", "bad") })).toEqual([
      [400, "failed"],
    ]);
    expect(await reads({ status: 200, body: reply('{"fits":[]}', "max_tokens") })).toEqual([
      [200, "cut-off"],
    ]);
    expect(await reads("unreachable", OVERLOADED, ANSWERED)).toEqual([
      [null, "unavailable"],
      [529, "unavailable"],
      [200, "answered"],
    ]);
  });
});

describe("a reply a proxy wrote", () => {
  it("tries a rate limit with no JSON body again", async () => {
    const wire = theWire({ status: 429, body: "<html>Too Many Requests</html>" }, ANSWERED);

    expect((await calling(wire)).outcome).toBe("answered");
    expect(wire.sent).toHaveLength(2);
  });

  it("fails a bad request with no JSON body, once", async () => {
    const wire = theWire({ status: 400, body: "<html>Bad Request</html>" });

    expect(await calling(wire)).toEqual({ outcome: "failed", spent: [NOTHING_SPENT] });
  });
});

describe("the client's own clock", () => {
  it("waits its backoff on the timer when none is injected", async () => {
    vi.useFakeTimers();
    try {
      const wire = theWire(OVERLOADED, ANSWERED);
      const client = openModelClient({
        fetch: wire.fetch,
        clock: { now: () => NOW },
        log: { info: () => undefined },
      });

      const called = client.callModel(TO_SONNET, A_CALL);
      await vi.advanceTimersByTimeAsync(1999);
      const before = wire.sent.length;
      await vi.advanceTimersByTimeAsync(1);

      expect(before).toBe(1);
      expect((await called).outcome).toBe("answered");
      expect(wire.sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

const credentials = openCredentials(ENVELOPE_KEY);

/** A workspace with a judging choice of `provider`, holding a key when `keyed`. */
const aWorkspace = async (
  choice: { readonly provider: string; readonly purpose?: "judging" | "answering" } | undefined,
  keyed = true,
) => {
  const workspace = await provisionedWorkspace(db(), "Acme");
  const asker = await principalFor(db(), workspace.workspaceId, workspace.adminUserId);
  if (choice !== undefined) {
    await seedingWith(db().pool, (seed) =>
      seed.modelChoice({
        id: `judge-${workspace.workspaceId}`,
        workspaceId: workspace.workspaceId,
        purpose: choice.purpose ?? "judging",
        provider: choice.provider,
        model: SONNET,
        dimensions: null,
      }),
    );
  }
  if (keyed) {
    answered(
      await setModelKey(bootstrap, openPostgres(db().pool), openModelKeySetting(ENVELOPE_KEY), {
        workspaceId: workspace.workspaceId,
        provider: "anthropic",
        key: A_KEY,
      }),
    );
  }
  return { workspaceId: workspace.workspaceId, asker };
};

const resolving = (asker: Awaited<ReturnType<typeof aWorkspace>>["asker"]) =>
  readingAs(db().runtimePool, asker, (principal, tx) =>
    resolveModel(principal, tx, credentials, "judging"),
  );

describe("resolving a workspace's model", () => {
  it("sends the workspace's judging model with its key", async () => {
    const { workspaceId, asker } = await aWorkspace({ provider: "anthropic" });
    const wire = theWire(ANSWERED);

    const to = answered(await resolving(asker));
    if (to === undefined) throw new Error("the workspace's judging model did not resolve");
    await clientOn(wire).client.callModel(to, A_CALL);

    expect({ ...to, key: to.key.reveal() }).toEqual({
      purpose: "judging",
      modelChoiceId: `judge-${workspaceId}`,
      provider: "anthropic",
      model: SONNET,
      key: A_KEY,
    });
    expect(wire.sent[0]?.init.headers).toMatchObject({ "x-api-key": A_KEY });
    expect(JSON.parse(wire.sent[0]?.body ?? "")).toMatchObject({ model: SONNET });
  });

  it("answers no model for a purpose with no choice", async () => {
    const { asker } = await aWorkspace({ provider: "anthropic", purpose: "answering" });

    expect(answered(await resolving(asker))).toBeUndefined();
  });

  it("answers no model for a workspace holding no key", async () => {
    const { asker } = await aWorkspace({ provider: "anthropic" }, false);

    expect(answered(await resolving(asker))).toBeUndefined();
  });

  it("answers no model for a provider no wire shape speaks", async () => {
    const { asker } = await aWorkspace({ provider: "mistral" });

    expect(answered(await resolving(asker))).toBeUndefined();
  });

  it("answers no model for a provider no key names", async () => {
    const { asker } = await aWorkspace({ provider: "local" });

    expect(answered(await resolving(asker))).toBeUndefined();
  });
});

const priced = async (provider: string, model: string, from: string) =>
  answered(
    await setModelPrice(PLATFORM, openPostgres(db().pool), {
      provider,
      model,
      effectiveFrom: from,
      gbpPerMillionIn: "1.6",
      gbpPerMillionOut: "8",
    }),
  );

const choosing = (workspaceId: string, provider: string, model = SONNET, purpose = "judging") =>
  setModelChoice(PLATFORM, openPostgres(db().pool), {
    workspaceId,
    purpose,
    provider,
    model,
    now: NOW,
  });

const choicesOf = async (workspaceId: string) =>
  (
    await db().pool.query(
      `SELECT purpose, provider, model, retention_tail AS "retentionTail"
         FROM model_choice WHERE workspace_id = $1 ORDER BY purpose`,
      [workspaceId],
    )
  ).rows;

const choiceEventsOf = async (workspaceId: string) =>
  (
    await db().pool.query(
      `SELECT actor, subject_id, detail FROM audit_event
        WHERE workspace_id = $1 AND action = 'platform.workspace.model_choice_set' ORDER BY at, id`,
      [workspaceId],
    )
  ).rows;

describe("setting a model choice", () => {
  it("stores and records a priced model of a sub-processor", async () => {
    await priced("anthropic", SONNET, "2026-10-01");
    const { workspaceId } = await aWorkspace(undefined, false);

    expect(answered(await choosing(workspaceId, "anthropic"))).toEqual({
      workspaceId,
      purpose: "judging",
      provider: "anthropic",
      model: SONNET,
    });
    expect(await choicesOf(workspaceId)).toEqual([
      { purpose: "judging", provider: "anthropic", model: SONNET, retentionTail: null },
    ]);
    expect(await choiceEventsOf(workspaceId)).toEqual([
      {
        actor: "process:better-answers-ops",
        subject_id: workspaceId,
        detail: { purpose: "judging", provider: "anthropic", model: SONNET },
      },
    ]);
  });

  it("refuses a provider with no sub-processor entry", async () => {
    const { workspaceId } = await aWorkspace(undefined, false);

    expect(await choosing(workspaceId, "openai", "gpt-6")).toEqual({
      ok: false,
      error: "no-sub-processor",
    });
    expect(await choicesOf(workspaceId)).toEqual([]);
  });

  it("refuses a model with no price in effect today", async () => {
    await priced("anthropic", "claude-haiku-5-5", "2026-10-16");
    const { workspaceId } = await aWorkspace(undefined, false);

    expect(await choosing(workspaceId, "anthropic", "claude-haiku-5-5")).toEqual({
      ok: false,
      error: "no-model-price",
    });
    expect(await choosing(workspaceId, "local", "clef-flash")).toEqual({
      ok: false,
      error: "no-model-price",
    });
    expect(await choiceEventsOf(workspaceId)).toEqual([]);
  });

  it("refuses a model choice for the embedding purpose", async () => {
    await priced("anthropic", SONNET, "2026-10-01");
    const { workspaceId } = await aWorkspace(undefined, false);

    expect(await choosing(workspaceId, "anthropic", SONNET, "embedding")).toEqual({
      ok: false,
      error: "fixed-model-choice",
    });
  });

  it("refuses a purpose, provider or model it cannot read", async () => {
    const { workspaceId } = await aWorkspace(undefined, false);

    for (const [provider, model, purpose] of [
      ["anthropic", SONNET, "guessing"],
      ["Anthropic", SONNET, "judging"],
      ["anthropic", "claude sonnet", "judging"],
    ] as const) {
      expect(await choosing(workspaceId, provider, model, purpose)).toEqual({
        ok: false,
        error: "malformed",
      });
    }
  });

  it("refuses a workspace that does not exist", async () => {
    await priced("anthropic", SONNET, "2026-10-01");

    expect(await choosing("01J9ZZZZZZZZZZZZZZZZZZZZZZ", "anthropic")).toEqual({
      ok: false,
      error: "no-such-workspace",
    });
  });

  it("replaces a choice in place, keeping its id", async () => {
    await priced("anthropic", SONNET, "2026-10-01");
    await priced("anthropic", "claude-haiku-5-5", "2026-10-01");
    const { workspaceId } = await aWorkspace({ provider: "anthropic" }, false);

    answered(await choosing(workspaceId, "anthropic", "claude-haiku-5-5"));

    const held = await db().pool.query(
      "SELECT id, model FROM model_choice WHERE workspace_id = $1",
      [workspaceId],
    );
    expect(held.rows).toEqual([{ id: `judge-${workspaceId}`, model: "claude-haiku-5-5" }]);
  });
});
