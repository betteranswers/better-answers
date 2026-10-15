import { describe, expect, it } from "vitest";
import { z } from "zod";

import { conceptIriOf, type ConceptIri } from "@better-answers/schema";

import {
  ask,
  askInput,
  ASK_CAPS,
  JUDGE_SYSTEM,
  judgeCall,
  type AskCaps,
  type ReturnedConcept,
} from "../src/answering/index.ts";
import type { PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import { openModelClient, openModelKeySetting, type ModelClient } from "../src/llm/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { setModelKey, setModelPrice, setSpendingLimit } from "../src/workspaces/index.ts";
import {
  asked,
  conceptSeeded,
  stepsFor,
  SUITE_ENVELOPE_KEY,
  type Asking,
  type SeededConcept,
} from "./asking.ts";
import { bootstrap, provisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { answered, postgresForSuite, seedingWith } from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

const db = postgresForSuite();

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };

const SONNET = "claude-sonnet-5-5";
const A_KEY = "sk-test-u13-invented-key-0001";

type Judging = { readonly limit?: string; readonly chosen?: boolean };

/** A workspace whose Admin asks, judging on Sonnet with a key, priced, under `limit` when given. */
const aJudgingWorkspace = async ({ limit = "100", chosen = true }: Judging = {}) => {
  const workspace = await provisionedWorkspace(db(), "Acme");
  const { workspaceId } = workspace;
  const asker = await principalFor(db(), workspaceId, workspace.adminUserId);
  answered(
    await setModelPrice(PLATFORM, openPostgres(db().pool), {
      provider: "anthropic",
      model: SONNET,
      effectiveFrom: "2026-01-01",
      gbpPerMillionIn: "3",
      gbpPerMillionOut: "15",
    }),
  );
  if (chosen) {
    await seedingWith(db().pool, (seed) =>
      seed.modelChoice({
        id: `judge-${workspaceId}`,
        workspaceId,
        purpose: "judging",
        provider: "anthropic",
        model: SONNET,
        dimensions: null,
      }),
    );
  }
  answered(
    await setModelKey(bootstrap, openPostgres(db().pool), openModelKeySetting(SUITE_ENVELOPE_KEY), {
      workspaceId,
      provider: "anthropic",
      key: A_KEY,
    }),
  );
  answered(await setSpendingLimit(PLATFORM, openPostgres(db().pool), { workspaceId, gbp: limit }));
  return { workspaceId, asker };
};

const anAnswer = (title: string, body: string, collection = "audits"): SeededConcept => ({
  collection,
  kind: "Answer",
  title,
  body,
});

const USERS = anAnswer(
  "How do buyers access audit information about their users' actions?",
  "Buyers download their users' audit log from the console.\n",
);
const SUPPLIER = anAnswer(
  "How do buyers access audit information about the supplier's actions?",
  "The supplier sends its own audit report on request.\n",
);
const RETENTION = anAnswer(
  "How long is audit information kept for buyers?",
  "Audit information is kept for thirteen months.\n",
);

const QUESTION = "How do buyers access audit information?";

type Sent = { readonly headers: unknown; readonly body: string };

const messagesBody = z.object({ messages: z.array(z.object({ content: z.string() })) });

const promptOf = (body: string): string =>
  messagesBody.parse(JSON.parse(body)).messages[0]?.content ?? "";

/** Each candidate's number and the question it was written for, as the prompt names them. */
const candidatesIn = (prompt: string): ReadonlyMap<string, string> =>
  new Map(
    [
      ...prompt.matchAll(
        /<candidate number="(\d+)">\n<collection>[^<]*<\/collection>\n<written_for>([^<]*)<\/written_for>/g,
      ),
    ].map(([, place = "", title = ""]) => [title, place]),
  );

const replyOf = (text: string) =>
  JSON.stringify({
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: SONNET,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1_580, output_tokens: 96 },
  });

type Wire = {
  readonly sent: Sent[];
  readonly client: ModelClient;
};

/** A judge at the wire saying yes to the candidates written for `fits`, and no to the rest. */
const judgeSaying = (
  fits: readonly string[],
  during: () => Promise<void> = async () => {},
): Wire => {
  const sent: Sent[] = [];
  const client = openModelClient({
    fetch: async (_input, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      sent.push({ headers: init?.headers, body });
      await during();
      const verdicts = Object.fromEntries(
        [...candidatesIn(promptOf(body))].map(([title, place]) => [
          place,
          fits.includes(title) ? "yes" : "no",
        ]),
      );
      return new Response(replyOf(JSON.stringify(verdicts)), { status: 200 });
    },
    clock: { now: () => new Date() },
    log: { info: () => {} },
  });
  return { sent, client };
};

/** Every attempt times out, as `fetch` does once its signal has fired. */
const judgeTimingOut = (): Wire => {
  const sent: Sent[] = [];
  const client = openModelClient({
    fetch: async (_input, init) => {
      sent.push({ headers: init?.headers, body: typeof init?.body === "string" ? init.body : "" });
      throw new DOMException("timed out", "TimeoutError");
    },
    clock: { now: () => new Date() },
    log: { info: () => {} },
    timeout: () => AbortSignal.abort(),
  });
  return { sent, client };
};

const askedWith = (asker: UserPrincipal, asking: Asking, wire: Wire, caps?: AskCaps) =>
  asked(db(), asker, asking, {
    judging: { callModel: wire.client.callModel },
    ...(caps === undefined ? {} : { caps }),
  });

/** One at a time: the seeder numbers each concept's path as it writes it. */
const seededIn = async (workspaceId: string, shapes: readonly SeededConcept[]) => {
  const iris: ConceptIri[] = [];
  for (const shape of shapes) iris.push(await conceptSeeded(db(), workspaceId, shape));
  return iris;
};

const recordOf = async (recordId: string) => {
  const read = await db().pool.query(
    `SELECT verdict, judge_state, concepts, completed_at IS NOT NULL AS completed
       FROM question_asked WHERE id = $1`,
    [recordId],
  );
  return read.rows[0];
};

const spendOf = async (workspaceId: string) => {
  const reservations = await db().pool.query(
    "SELECT count(*)::integer AS open FROM spend_reservation WHERE workspace_id = $1",
    [workspaceId],
  );
  const calls = await db().pool.query(
    "SELECT outcome, tokens_in, tokens_out, answer_id FROM llm_call WHERE workspace_id = $1",
    [workspaceId],
  );
  return { open: reservations.rows[0]?.open, calls: calls.rows };
};

const titlesOf = (concepts: readonly { readonly title: string }[]) =>
  concepts.map(({ title }) => title).toSorted();

describe("the judge's call", () => {
  const candidate: ReturnedConcept = {
    iri: conceptIriOf("01J6AAAAAAAAAAAAAAAAAAAAAA"),
    url: "/knowledge/search/01J6AAAAAAAAAAAAAAAAAAAAAA",
    kind: "Answer",
    title: "How long are audit logs kept?",
    collection: "audits",
    body: "Audit logs are kept for thirteen months.\n",
    trust: {
      tier: "unverified",
      status: "current",
      verifiedBy: null,
      verifiedAt: null,
      rider: null,
    },
    trustWords: "Unverified",
    evidence: [],
  };

  it("holds each candidate apart, numbered, with its collection", () => {
    const call = judgeCall("How long are audit logs kept?", [
      candidate,
      {
        ...candidate,
        iri: conceptIriOf("01J6BBBBBBBBBBBBBBBBBBBBBB"),
        title: "Who reads the audit log?",
        collection: null,
        body: "Admins read it.",
      },
    ]);

    expect(call.system).toBe(JUDGE_SYSTEM);
    expect(call.prompt).toBe(
      [
        "<question>",
        "How long are audit logs kept?",
        "</question>",
        "",
        '<candidate number="1">',
        "<collection>audits</collection>",
        "<written_for>How long are audit logs kept?</written_for>",
        "<answer>",
        "Audit logs are kept for thirteen months.",
        "</answer>",
        "</candidate>",
        '<candidate number="2">',
        "<collection>none</collection>",
        "<written_for>Who reads the audit log?</written_for>",
        "<answer>",
        "Admins read it.",
        "</answer>",
        "</candidate>",
      ].join("\n"),
    );
  });

  it("asks one verdict of yes or no under every number", () => {
    const call = judgeCall("Who?", [candidate]);

    expect(call.answer.safeParse({ "1": "yes" }).success).toBe(true);
    expect(call.answer.safeParse({}).success).toBe(false);
    expect(call.answer.safeParse({ "1": "maybe" }).success).toBe(false);
    expect(call.answer.safeParse({ "1": "yes", "2": "no" }).success).toBe(false);
  });

  it("reserves every byte sent and room to think", () => {
    const call = judgeCall("Who?", [candidate]);
    const bytes = new TextEncoder().encode(JUDGE_SYSTEM + call.prompt).length;

    expect(call.most).toEqual({ tokensIn: bytes + 2_000, tokensOut: 12_016 });
  });

  it("AE11: sends a placeholder for a National Insurance number", () => {
    const call = judgeCall("Is my National Insurance number AB 12 34 56 C on file?", [candidate]);

    expect(call.prompt).toContain("Is my National Insurance number [withheld] on file?");
    expect(call.prompt).not.toContain("AB 12 34 56 C");
  });
});

describe("ask with a judge", () => {
  it("AE1: returns two fits word for word, the third related", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace();
    await seededIn(workspaceId, [USERS, SUPPLIER, RETENTION]);
    const wire = judgeSaying([USERS.title, SUPPLIER.title]);

    const answer = await askedWith(asker, { question: QUESTION, collections: ["audits"] }, wire);

    expect([answer.verdict, answer.judgeState]).toEqual(["ok", "judged"]);
    expect(answer.answers.map(({ title, body }) => ({ title, body })).toSorted()).toEqual(
      [USERS, SUPPLIER].map(({ title, body }) => ({ title, body })).toSorted(),
    );
    expect(titlesOf(answer.related)).toEqual([RETENTION.title]);
    expect(wire.sent).toHaveLength(1);
    expect(wire.sent[0]?.headers).toMatchObject({ "x-api-key": A_KEY });
  });

  it("AE3: returns Standard and Advanced fits side by side", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace();
    const standard = anAnswer(
      "How do Standard buyers export audit information?",
      "Standard buyers export it as CSV.\n",
    );
    const advanced = anAnswer(
      "How do Advanced buyers export audit information?",
      "Advanced buyers export it through the API.\n",
    );
    await seededIn(workspaceId, [standard, advanced]);
    const wire = judgeSaying([standard.title, advanced.title]);

    const answer = await askedWith(
      asker,
      { question: "How do buyers export audit information?", collections: ["audits"] },
      wire,
    );

    expect(answer.verdict).toBe("ok");
    expect(titlesOf(answer.answers)).toEqual([advanced.title, standard.title]);
    expect(answer.related).toEqual([]);
  });

  it("answers related, judged, when the judge says no to all", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace();
    await seededIn(workspaceId, [USERS, SUPPLIER]);

    const answer = await askedWith(asker, { question: QUESTION }, judgeSaying([]));

    expect([answer.verdict, answer.judgeState, answer.answers]).toEqual(["related", "judged", []]);
    expect(titlesOf(answer.related)).toEqual([USERS.title, SUPPLIER.title].toSorted());
  });

  it("answers related, judging failed, settling a timed-out call", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace();
    await seededIn(workspaceId, [USERS]);

    const answer = await askedWith(asker, { question: QUESTION }, judgeTimingOut());

    expect([answer.verdict, answer.judgeState, answer.answers]).toEqual([
      "related",
      "judging-failed",
      [],
    ]);
    expect(titlesOf(answer.related)).toEqual([USERS.title]);
    expect(await spendOf(workspaceId)).toEqual({
      open: 0,
      calls: [{ outcome: "failed", tokens_in: 0, tokens_out: 0, answer_id: answer.recordId }],
    });
  });

  it("settles a judged call as one succeeded llm_call row", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace();
    await seededIn(workspaceId, [USERS]);

    const answer = await askedWith(asker, { question: QUESTION }, judgeSaying([USERS.title]));

    expect(await spendOf(workspaceId)).toEqual({
      open: 0,
      calls: [
        { outcome: "succeeded", tokens_in: 1_580, tokens_out: 96, answer_id: answer.recordId },
      ],
    });
  });

  it("AE9: refuses at the limit, calls nothing, keeps the question", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace({ limit: "0.01" });
    await seededIn(workspaceId, [USERS]);
    const wire = judgeSaying([USERS.title]);

    const refused = await ask(
      asker,
      stepsFor(db().runtimePool, asker, { callModel: wire.client.callModel }),
      inputOf(askInput, { question: QUESTION }),
      new Date(),
    );

    expect(refused).toEqual({ ok: false, error: "spending-limit-met" });
    expect(wire.sent).toEqual([]);
    const kept = await db().pool.query(
      `SELECT c.question, r.completed_at IS NOT NULL AS completed
         FROM question_asked r JOIN question_content c ON c.record_id = r.id
        WHERE r.workspace_id = $1`,
      [workspaceId],
    );
    expect(kept.rows).toEqual([{ question: QUESTION, completed: false }]);
    expect(await spendOf(workspaceId)).toEqual({ open: 0, calls: [] });
  });

  it("answers at the limit where no `Answer` is a candidate", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace({ limit: "0.01" });
    await seededIn(workspaceId, [
      { collection: "audits", title: "Audit information access", body: "Buyers ask support.\n" },
    ]);
    const wire = judgeSaying([]);

    const answer = await askedWith(asker, { question: QUESTION }, wire);

    expect([answer.verdict, answer.judgeState]).toEqual(["related", "not-judged"]);
    expect(wire.sent).toEqual([]);
  });

  it("AE10: calls nothing with no judging model choice", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace({ chosen: false });
    await seededIn(workspaceId, [USERS, SUPPLIER]);
    const wire = judgeSaying([USERS.title, SUPPLIER.title]);

    const answer = await askedWith(asker, { question: QUESTION, collections: ["audits"] }, wire);

    expect([answer.verdict, answer.judgeState, answer.answers]).toEqual([
      "related",
      "not-judged",
      [],
    ]);
    expect(titlesOf(answer.related)).toEqual([USERS.title, SUPPLIER.title].toSorted());
    expect(wire.sent).toEqual([]);
    expect(await spendOf(workspaceId)).toEqual({ open: 0, calls: [] });
  });

  it("keeps an `Answer` past the cap related, and unsent", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace();
    await seededIn(workspaceId, [USERS, SUPPLIER]);
    const wire = judgeSaying([USERS.title, SUPPLIER.title]);

    const answer = await askedWith(asker, { question: QUESTION }, wire, {
      ...ASK_CAPS,
      candidates: 1,
    });

    const sentFor = [...candidatesIn(promptOf(wire.sent[0]?.body ?? ""))];
    expect(sentFor).toHaveLength(1);
    expect(titlesOf(answer.answers)).toEqual(sentFor.map(([title]) => title));
    expect(answer.related.map(({ kind }) => kind)).toEqual(["Answer"]);
  });

  it("records the judge's verdict for each candidate sent", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace();
    const [users, supplier, note] = await seededIn(workspaceId, [
      USERS,
      SUPPLIER,
      { collection: "audits", title: "Audit information access", body: "Buyers ask support.\n" },
    ]);

    const answer = await askedWith(asker, { question: QUESTION }, judgeSaying([USERS.title]));

    const record = await recordOf(answer.recordId);
    const judged = new Map(
      record?.concepts.map((concept: { iri: string; judged?: string }) => [
        concept.iri,
        concept.judged,
      ]),
    );
    expect([record?.verdict, record?.judge_state, record?.completed]).toEqual([
      "ok",
      "judged",
      true,
    ]);
    expect([judged.get(users ?? ""), judged.get(supplier ?? ""), judged.get(note ?? "")]).toEqual([
      "yes",
      "no",
      undefined,
    ]);
  });

  it("holds no connection while the judge is called", async () => {
    const { workspaceId, asker } = await aJudgingWorkspace();
    await seededIn(workspaceId, [USERS]);
    const contended: string[] = [];
    const contender = async () => {
      const client = await db().pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `LOCK TABLE question_asked, question_content, spend_reservation, llm_call,
                      workspace_config, model_choice, model_key
             IN ACCESS EXCLUSIVE MODE NOWAIT`,
        );
        contended.push("locked");
      } catch (cause) {
        contended.push(cause instanceof Error ? cause.message : String(cause));
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    };

    const answer = await askedWith(
      asker,
      { question: QUESTION },
      judgeSaying([USERS.title], contender),
    );

    expect(contended).toEqual(["locked"]);
    expect(answer.verdict).toBe("ok");
  });
});
