import { trpcServer } from "@hono/trpc-server";
import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { until } from "@better-answers/core/testing/postgres";
import { TAB_WORKSPACE_HEADER } from "@better-answers/schema/tab-workspace";

import { askedFrom } from "../../web/src/shared/api/ask-stream.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { connectAsHost } from "./flow.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import {
  aModelWire,
  AUDIT_ANSWERS,
  AUDIT_QUESTION as QUESTION,
  judgeSaying,
  judgingSetUp,
} from "./harness-model.ts";
import { feedbackKeptOn as feedbackOf, recordsIn as recordsOf } from "./harness-questions.ts";
import { servedOnLoopback } from "./loopback-port.ts";
import { structured, toolAnswered, type Rpc } from "./mcp-call.ts";
import { appForSuite, aStoppableClock } from "./suite-app.ts";
import { refusalOfCall, webClientOf } from "./web-client.ts";

const wire = aModelWire();

const { clock, stopTheClock } = aStoppableClock();

const app = appForSuite({ fetchModel: wire.fetch, clock });

const { users: USERS, supplier: SUPPLIER, retention: RETENTION } = AUDIT_ANSWERS;

const A_NOTE = "The period changed in May.";

/** MCP_TOKEN_RULE's numbers: one connection's calls a minute. */
const READS_A_MINUTE = 120;

/** Signed in on the web and connected over MCP as the same person. */
const bothWays = async (person: { readonly id: string; readonly email: string }, held: string) => {
  const client = app().client();
  const tokens = await connectAsHost(app(), client, person, {
    scope: "knowledge:read feedback:write offline_access",
  });
  return {
    web: webClientOf(client, held).api,
    client,
    mcp: async (name: string, args: Rpc) =>
      structured(await toolAnswered(client, tokens.accessToken, name, args)),
  };
};

/** A workspace holding three `Answer`s, set to judge, and its Admin both ways. */
const anAdminAsking = async (limitGbp?: string) => {
  const workspace = await app().provision();
  await seedConcepts(
    app(),
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [USERS, SUPPLIER, RETENTION],
    }),
  );
  // Uncounted, the planner joins every node to every step, and the walk nears its timeout.
  await app().database.superuser.query("ANALYZE map_node, map_edge");
  await judgingSetUp(app(), workspace.workspaceId, limitGbp === undefined ? {} : { limitGbp });
  return { workspace, ...(await bothWays(workspace.admin, workspace.workspaceId)) };
};

type Web = Awaited<ReturnType<typeof anAdminAsking>>["web"];

type Asking = Parameters<Web["ask"]["question"]["mutate"]>[0];

/** Every event of one stream, in the order it arrived. */
const streamed = async (web: Web, asking: Asking) => {
  const events = [];
  for await (const event of await web.ask.question.mutate(asking)) {
    events.push(event);
  }
  return events;
};

const recordsIn = (workspaceId: string) => recordsOf(app(), workspaceId);

/** The spend a workspace holds: reservations not yet settled, and the calls settled. */
const spendIn = async (workspaceId: string) => {
  const counted = await app().database.superuser.query(
    `SELECT (SELECT count(*)::int FROM spend_reservation WHERE workspace_id = $1) AS reserved,
            (SELECT count(*)::int FROM llm_call WHERE workspace_id = $1) AS called`,
    [workspaceId],
  );
  return counted.rows[0];
};

const feedbackKeptOn = (recordId: string) => feedbackOf(app(), recordId);

const ANSWERED_IN_FULL = {
  verdict: "ok",
  judgeState: "judged",
  answers: [expect.objectContaining({ title: USERS.title, body: `${USERS.body}\n` })],
};

describe("ask over tRPC", () => {
  it("opens its stream with the whole result, verdict first", async () => {
    const { workspace, web } = await anAdminAsking();
    wire.answerWith(judgeSaying([USERS.title]));

    const events = await streamed(web, { question: QUESTION });

    expect(events).toEqual([{ kind: "result", result: expect.objectContaining(ANSWERED_IN_FULL) }]);
    expect(await recordsIn(workspace.workspaceId)).toEqual([
      {
        transport: "trpc",
        verdict: "ok",
        judge_state: "judged",
        completed: true,
        question: QUESTION,
      },
    ]);
  });

  it("refuses a GET, keeping no record and no reservation", async () => {
    const { workspace, client } = await anAdminAsking();
    const input = encodeURIComponent(JSON.stringify({ question: QUESTION }));

    const got = await client.fetch(`${TRPC_ENDPOINT}/ask.question?input=${input}`);

    expect(got.status).toBe(405);
    expect(await recordsIn(workspace.workspaceId)).toEqual([]);
    expect(await spendIn(workspace.workspaceId)).toEqual({ reserved: 0, called: 0 });
  });

  it("refuses a person past their knowledge ceiling, answering another", async () => {
    const { workspace, web, client } = await anAdminAsking();
    const colleague = await app().person();
    await app().addMember(workspace.workspaceId, colleague.id, "Viewer");
    const theirs = await bothWays(colleague, workspace.workspaceId);
    wire.answerWith(judgeSaying([USERS.title]));
    stopTheClock();

    await Promise.all(
      Array.from({ length: READS_A_MINUTE }, () => web.knowledge.find.query({ query: QUESTION })),
    );
    const refused = await refusalOfCall(streamed(web, { question: QUESTION }));
    const onTheWire = await client.fetch(`${TRPC_ENDPOINT}/ask.question?batch=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "trpc-accept": "application/jsonl",
        [TAB_WORKSPACE_HEADER]: workspace.workspaceId,
      },
      body: JSON.stringify({ 0: { question: QUESTION } }),
    });
    const answered = await streamed(theirs.web, { question: QUESTION });

    expect(refused).toMatchObject({
      data: { code: "TOO_MANY_REQUESTS", retryAfterSeconds: expect.any(Number) },
    });
    // A stream sends its status before any call settles, so the wait rides in the error alone.
    expect([onTheWire.status, onTheWire.headers.get("retry-after")]).toEqual([200, null]);
    expect(await onTheWire.text()).toContain('"retryAfterSeconds"');
    expect(answered.map(({ result }) => result.verdict)).toEqual(["ok"]);
    expect(await recordsIn(workspace.workspaceId)).toEqual([
      expect.objectContaining({ transport: "trpc", completed: true }),
    ]);
  });

  it("folds to what MCP answers, apart from prose and record", async () => {
    const { web, mcp } = await anAdminAsking();
    wire.answerWith(judgeSaying([USERS.title]));
    const asking = { question: QUESTION, collections: ["audits"] };

    const folded = askedFrom(await streamed(web, asking));
    const overMcp = await mcp("ask", asking);

    if (folded === undefined) throw new Error("the stream carried no event");
    const { recordId: webRecord, prose, ...onTheWeb } = folded;
    const { recordId: mcpRecord, ...overTheWire } = inCoreTerms(overMcp, app().publicUrl);
    expect(onTheWeb).toEqual(overTheWire);
    expect(onTheWeb).toMatchObject(ANSWERED_IN_FULL);
    expect(prose).toEqual([]);
    expect(webRecord).not.toBe(mcpRecord);
  });

  it("ends the stream with a refusal and no prose", async () => {
    const { workspace, web } = await anAdminAsking("0.001");
    wire.answerWith(judgeSaying([USERS.title]));
    const events: unknown[] = [];

    const refused = await refusalOfCall(
      (async () => {
        for await (const event of await web.ask.question.mutate({ question: QUESTION })) {
          events.push(event);
        }
      })(),
    );

    expect(refused).toMatchObject({ data: { refusal: { word: "spending-limit-met" } } });
    expect(events).toEqual([]);
    expect(await recordsIn(workspace.workspaceId)).toEqual([
      { transport: "trpc", verdict: null, judge_state: null, completed: false, question: QUESTION },
    ]);
  });

  it("completes its record and settles when its client leaves mid-ask", async () => {
    const { workspace, web } = await anAdminAsking();
    const judging = Promise.withResolvers<void>();
    const called = Promise.withResolvers<void>();
    wire.answerWith(async (sent) => {
      called.resolve();
      await judging.promise;
      return judgeSaying([USERS.title])(sent);
    });
    const leaving = new AbortController();

    // In process, an abort never errors the body the client reads, so only the server's side is awaited.
    void refusalOfCall(web.ask.question.mutate({ question: QUESTION }, { signal: leaving.signal }));
    await called.promise;
    leaving.abort();
    judging.resolve();
    await until(async () => (await spendIn(workspace.workspaceId))?.["called"] === 1);

    expect(await recordsIn(workspace.workspaceId)).toEqual([
      {
        transport: "trpc",
        verdict: "ok",
        judge_state: "judged",
        completed: true,
        question: QUESTION,
      },
    ]);
    expect(await spendIn(workspace.workspaceId)).toEqual({ reserved: 0, called: 1 });
  });

  it("never queries through a transaction that has settled", async () => {
    const { web } = await anAdminAsking();
    wire.answerWith(judgeSaying([USERS.title]));
    const before = app().logs.length;

    await streamed(web, { question: QUESTION });

    expect(JSON.stringify(app().logs.slice(before))).not.toContain("the transaction has settled");
  });
});

const answeredRecord = z.object({ recordId: z.string() });

describe("feedback over tRPC", () => {
  it("stores what give_feedback stores for the same input", async () => {
    const { workspace, web, mcp } = await anAdminAsking();
    wire.answerWith(judgeSaying([USERS.title]));
    const overMcp = answeredRecord.parse(await mcp("ask", { question: QUESTION })).recordId;
    const [opened] = await streamed(web, { question: QUESTION });
    const onTheWeb = opened?.result.recordId ?? "";
    const flag = { verdict: "flag", reason: "out-of-date", note: A_NOTE } as const;

    await mcp("give_feedback", { recordId: overMcp, ...flag });
    await web.ask.giveFeedback.mutate({ recordId: onTheWeb, ...flag });

    const kept = {
      given_by: `human:${workspace.admin.id}`,
      verdict: "flag",
      reason: "out-of-date",
      note: A_NOTE,
      disputed_sentence: null,
      disputed_concept: null,
    };
    expect(await feedbackKeptOn(overMcp)).toEqual([kept]);
    expect(await feedbackKeptOn(onTheWeb)).toEqual([kept]);
  });
});

const wireConcept = z.looseObject({
  url: z.string(),
  trust: z.looseObject({ checkedBy: z.string().nullable(), checkedAt: z.string().nullable() }),
});

const wireAnswer = z.looseObject({
  recordId: z.string(),
  answers: z.array(wireConcept),
  related: z.array(wireConcept),
});

/** MCP's answer in core's words: its trust keys renamed back, and each address under no origin. */
const inCoreTerms = (answered: Rpc, origin: string) => {
  const { answers, related, ...rest } = wireAnswer.parse(answered);
  const core = ({ url, trust, ...concept }: z.infer<typeof wireConcept>) => {
    const { checkedBy, checkedAt, ...kept } = trust;
    return {
      ...concept,
      url: url.slice(origin.length),
      trust: { ...kept, verifiedBy: checkedBy, verifiedAt: checkedAt },
    };
  };
  return { ...rest, answers: answers.map(core), related: related.map(core) };
};

describe("a streamed mutation through the Hono mount", () => {
  it("delivers its first event while the next is held", async () => {
    const held = Promise.withResolvers<void>();
    const t = initTRPC.create();
    const streaming = t.router({
      twice: t.procedure.mutation(async function* () {
        yield "first";
        await held.promise;
        yield "second";
      }),
    });
    const mount = new Hono();
    mount.use(`${TRPC_ENDPOINT}/*`, trpcServer({ router: streaming, endpoint: TRPC_ENDPOINT }));

    await servedOnLoopback(mount, async (origin) => {
      const streamed = createTRPCClient<typeof streaming>({
        links: [httpBatchStreamLink({ url: `${origin}${TRPC_ENDPOINT}` })],
      });
      const waited = Promise.withResolvers<"still held">();
      const timer = setTimeout(() => waited.resolve("still held"), 5_000);
      const events = (async () => (await streamed.twice.mutate())[Symbol.asyncIterator]())();
      // A buffered mount sends nothing until the second is released, so the race ends it.
      const first = await Promise.race([events.then((stream) => stream.next()), waited.promise]);
      clearTimeout(timer);
      held.resolve();
      const second = await (await events).next();

      expect([first, second]).toEqual([
        { done: false, value: "first" },
        { done: false, value: "second" },
      ]);
    });
  });
});
