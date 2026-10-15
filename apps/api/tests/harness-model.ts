import { z } from "zod";

import { ok } from "@better-answers/core/kernel";
import { openModelKeySetting } from "@better-answers/core/llm";

import { runOps } from "../src/ops/index.ts";
import { capturingLogger, HARNESS_ENVELOPE_KEY, type TestApp } from "./harness.ts";

export const SONNET = "claude-sonnet-5-5";

/** Invented: it reaches no provider. */
export const A_MODEL_KEY = "sk-test-u13-invented-key-0002";

export type SentToModel = {
  readonly url: string;
  readonly headers: unknown;
  readonly body: string;
};

type Answering = (sent: SentToModel) => Response | Promise<Response>;

/** The provider's side of the wire: each request kept, each answered as the test last said. */
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
      };
      sent.push(one);
      return await answering.current(one);
    },
  };
};

const messagesBody = z.object({ messages: z.array(z.object({ content: z.string() })) });

/** The prompt one request carried. */
export const promptSent = (sent: SentToModel): string =>
  messagesBody.parse(JSON.parse(sent.body)).messages[0]?.content ?? "";

export const replyOf = (text: string): Response =>
  new Response(
    JSON.stringify({
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: SONNET,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1_580, output_tokens: 96 },
    }),
    { status: 200 },
  );

/** A judge saying yes to each candidate written for one of `fits`, and no to the rest. */
export const judgeSaying =
  (fits: readonly string[]): Answering =>
  (sent) => {
    const numbered = promptSent(sent).matchAll(
      /<candidate number="(\d+)">\n<collection>[^<]*<\/collection>\n<written_for>([^<]*)<\/written_for>/g,
    );
    return replyOf(
      JSON.stringify(
        Object.fromEntries(
          [...numbered].map(([, place = "", title = ""]) => [
            place,
            fits.includes(title) ? "yes" : "no",
          ]),
        ),
      ),
    );
  };

/** One ops command run as the owner runs it on the `api` service, its key on standard input. */
export const opsRun = async (
  app: TestApp,
  argv: readonly string[],
  stdin = "",
): Promise<readonly string[]> => {
  const lines: string[] = [];
  const exitCode = await runOps(argv, app.doors, {
    fetch: async (url, init) => app.server.request(url, init),
    stdin: async () => stdin,
    say: (line) => {
      lines.push(line);
    },
    logger: capturingLogger().logger,
    modelKeySetting: ok(openModelKeySetting(HARNESS_ENVELOPE_KEY)),
  });
  if (exitCode !== 0) throw new Error(`ops ${argv.join(" ")} exited ${String(exitCode)}`);
  return lines;
};

type JudgingSet = { readonly limitGbp?: string; readonly chosen?: boolean };

/** In the RUNBOOK's order: the key, the price, the limit, then the choice, which needs the price. */
export const judgingSetUp = async (
  app: TestApp,
  workspaceId: string,
  { limitGbp = "100", chosen = true }: JudgingSet = {},
): Promise<void> => {
  const workspace = ["--workspace", workspaceId];
  await opsRun(app, ["set-model-key", ...workspace, "--provider", "anthropic"], A_MODEL_KEY);
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
  if (!chosen) return;
  await opsRun(app, [
    "set-model-choice",
    ...workspace,
    "--purpose",
    "judging",
    "--provider",
    "anthropic",
    "--model",
    SONNET,
  ]);
};
