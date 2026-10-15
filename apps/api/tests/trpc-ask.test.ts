import { describe, expect, it } from "vitest";
import { z } from "zod";

import { askedFrom } from "../../web/src/shared/api/ask-stream.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { connectAsHost } from "./flow.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import { aModelWire, judgeSaying, judgingSetUp } from "./harness-model.ts";
import { structured, toolAnswered, type Rpc } from "./mcp-call.ts";
import { appForSuite, aStoppableClock } from "./suite-app.ts";
import { refusalOfCall, webClientOf } from "./web-client.ts";

const wire = aModelWire();

const { clock, stopTheClock } = aStoppableClock();

const app = appForSuite({ fetchModel: wire.fetch, clock });

const USERS = {
  title: "How do buyers access audit information about their users' actions?",
  collection: "audits",
  body: "Buyers download their users' audit log from the console.",
};
const SUPPLIER = {
  title: "How do buyers access audit information about the supplier's actions?",
  collection: "audits",
  body: "The supplier sends its own audit report on request.",
};
const RETENTION = {
  title: "How long is audit information kept for buyers?",
  collection: "audits",
  body: "Audit information is kept for thirteen months.",
};

const QUESTION = "How do buyers access audit information?";

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

const recordsIn = async (workspaceId: string) => {
  const kept = await app().database.superuser.query(
    `SELECT r.transport, r.verdict, r.judge_state, r.completed_at IS NOT NULL AS completed, c.question
       FROM question_asked r JOIN question_content c ON c.record_id = r.id
      WHERE r.workspace_id = $1`,
    [workspaceId],
  );
  return kept.rows;
};

/** The spend a workspace holds: reservations not yet settled, and the calls settled. */
const spendIn = async (workspaceId: string) => {
  const counted = await app().database.superuser.query(
    `SELECT (SELECT count(*)::int FROM spend_reservation WHERE workspace_id = $1) AS reserved,
            (SELECT count(*)::int FROM llm_call WHERE workspace_id = $1) AS called`,
    [workspaceId],
  );
  return counted.rows[0];
};

const feedbackKeptOn = async (recordId: string) => {
  const kept = await app().database.superuser.query(
    `SELECT given_by, verdict, reason, note, disputed_sentence, disputed_concept
       FROM question_feedback WHERE record_id = $1 ORDER BY given_at, id`,
    [recordId],
  );
  return kept.rows;
};

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
    const { workspace, web } = await anAdminAsking();
    const colleague = await app().person();
    await app().addMember(workspace.workspaceId, colleague.id, "Viewer");
    const theirs = await bothWays(colleague, workspace.workspaceId);
    wire.answerWith(judgeSaying([USERS.title]));
    stopTheClock();

    await Promise.all(
      Array.from({ length: READS_A_MINUTE }, () => web.knowledge.find.query({ query: QUESTION })),
    );
    const refused = await refusalOfCall(streamed(web, { question: QUESTION }));
    const answered = await streamed(theirs.web, { question: QUESTION });

    expect(refused).toMatchObject({
      data: { code: "TOO_MANY_REQUESTS", retryAfterSeconds: expect.any(Number) },
    });
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

    const { recordId: webRecord, prose, ...onTheWeb } = folded ?? { recordId: "", prose: [] };
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

  it("completes its record and settles when its client leaves", async () => {
    const { workspace, web } = await anAdminAsking();
    wire.answerWith(judgeSaying([USERS.title]));
    const leaving = new AbortController();
    const events: unknown[] = [];

    for await (const event of await web.ask.question.mutate(
      { question: QUESTION },
      { signal: leaving.signal },
    )) {
      events.push(event);
      leaving.abort();
      break;
    }

    expect(events).toHaveLength(1);
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
