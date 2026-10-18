import { ok } from "@better-answers/core/kernel";
import { openModelKeySetting } from "@better-answers/core/llm";
import {
  judgeReplyTo,
  promptOf,
  streamedEventsOf,
  streamedResponse,
} from "@better-answers/core/testing/judge-wire";

import { runOps } from "../src/ops/index.ts";
import { connectAsHost } from "./flow.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import { capturingLogger, HARNESS_ENVELOPE_KEY, type TestApp } from "./harness.ts";
import { toolAnswered, type Rpc } from "./mcp-call.ts";

export const SONNET = "claude-sonnet-5-5";

export const AUDIT_ANSWERS = {
  users: {
    title: "How do buyers access audit information about their users' actions?",
    collection: "audits",
    body: "Buyers download their users' audit log from the console.",
  },
  supplier: {
    title: "How do buyers access audit information about the supplier's actions?",
    collection: "audits",
    body: "The supplier sends its own audit report on request.",
  },
  retention: {
    title: "How long is audit information kept for buyers?",
    collection: "audits",
    body: "Audit information is kept for thirteen months.",
  },
  lms: {
    title: "How do buyers access audit information in the LMS?",
    collection: "lms",
    body: "The LMS exports its audit trail to buyers.",
  },
};

export const AUDIT_QUESTION = "How do buyers access audit information?";

export const A_MODEL_KEY = "sk-test-u13-invented-key-0002";

export type SentToModel = {
  readonly url: string;
  readonly headers: unknown;
  readonly body: string;
  readonly signal: AbortSignal | null | undefined;
};

type Answering = (sent: SentToModel) => Response | Promise<Response>;

export const aModelWire = () => {
  const sent: SentToModel[] = [];
  const answering: { current: Answering } = {
    current: () => new Response("no answer was set for this test", { status: 418 }),
  };
  return {
    sent,
    answerWith: (answer: Answering) => {
      answering.current = answer;
    },
    fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const one = {
        url: input instanceof Request ? input.url : String(input),
        headers: init?.headers,
        body: typeof init?.body === "string" ? init.body : "",
        signal: init?.signal,
      };
      sent.push(one);
      return await answering.current(one);
    },
  };
};

export const promptSent = (sent: Pick<SentToModel, "body">): string => promptOf(sent.body);

export const judgeSaying =
  (fits: readonly string[]): Answering =>
  (sent) =>
    new Response(judgeReplyTo(fits, sent.body), { status: 200 });

const opsRun = async (app: TestApp, argv: readonly string[], stdin = ""): Promise<void> => {
  const exitCode = await runOps(argv, app.doors, {
    fetch: async (url, init) => app.server.request(url, init),
    stdin: async () => stdin,
    say: () => {},
    logger: capturingLogger().logger,
    modelKeySetting: ok(openModelKeySetting(HARNESS_ENVELOPE_KEY)),
  });
  if (exitCode !== 0) throw new Error(`ops ${argv.join(" ")} exited ${String(exitCode)}`);
};

type JudgingSet = {
  readonly limitGbp?: string;
  readonly chosen?: boolean;
  readonly drafting?: boolean;
  readonly key?: string;
};

const modelChosen = (app: TestApp, workspaceId: string, purpose: string) =>
  opsRun(app, [
    "set-model-choice",
    "--workspace",
    workspaceId,
    "--purpose",
    purpose,
    "--provider",
    "anthropic",
    "--model",
    SONNET,
  ]);

export const judgingSetUp = async (
  app: TestApp,
  workspaceId: string,
  { limitGbp = "100", chosen = true, drafting = false, key = A_MODEL_KEY }: JudgingSet = {},
): Promise<void> => {
  const workspace = ["--workspace", workspaceId];
  await opsRun(app, ["set-model-key", ...workspace, "--provider", "anthropic"], key);
  await opsRun(app, [
    "set-model-price",
    "--provider",
    "anthropic",
    "--model",
    SONNET,
    "--from",
    "2026-01-01",
    "--gbp-per-million-in",
    "1.6",
    "--gbp-per-million-out",
    "8",
  ]);
  await opsRun(app, ["set-spending-limit", ...workspace, "--gbp", limitGbp]);
  if (drafting) await modelChosen(app, workspaceId, "answering");
  if (chosen) await modelChosen(app, workspaceId, "judging");
};

export const endedWith = (signal: AbortSignal | null | undefined): Promise<never> =>
  new Promise((_resolve, reject) => {
    const end = () => reject(new DOMException("aborted", "AbortError"));
    if (signal?.aborted === true) end();
    signal?.addEventListener("abort", end, { once: true });
  });

export const drafterWriting =
  (lines: (prompt: string) => readonly string[]): Answering =>
  (sent) =>
    streamedResponse(streamedEventsOf(lines(promptOf(sent.body))), { signal: sent.signal });

export const anAdminAsking = async (app: TestApp, concepts: readonly Rpc[]) => {
  const workspace = await app.provision();
  await seedConcepts(
    app,
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts,
    }),
  );
  // Uncounted, the planner joins every node to every step, and the walk nears its timeout.
  await app.database.superuser.query("ANALYZE map_node, map_edge");
  const client = app.client();
  const tokens = await connectAsHost(app, client, workspace.admin, {
    scope: "knowledge:read offline_access",
  });
  return {
    workspaceId: workspace.workspaceId,
    asking: (args: Rpc) => toolAnswered(client, tokens.accessToken, "ask", args),
  };
};
