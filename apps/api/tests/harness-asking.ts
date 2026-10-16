import { z } from "zod";

import {
  conceptNumbersIn,
  promptOf,
  streamedEventsOf,
  streamedResponse,
} from "@better-answers/core/testing/judge-wire";

import { endedWith, judgeSaying, judgingSetUp } from "./harness-model.ts";
import type { TestApp } from "./harness.ts";

const KEY_PREFIX = "sk-test-browser-";

const keyOf = (workspaceId: string): string => `${KEY_PREFIX}${workspaceId}`;

/** A status the client reads as failed, never as one worth trying again. */
const FAILED_STATUS = 418;

const written = z.object({
  citing: z.string().min(1),
  sentence: z.string().min(1),
});

type Written = z.output<typeof written>;

const HELD_CALLS = ["judge", "draft"] as const;

export const askingScripting = z.object({
  workspaceId: z.string().min(1),
  judging: z.union([z.object({ fits: z.array(z.string()) }), z.literal("fails")]).optional(),
  drafting: z.union([z.object({ writes: z.array(written) }), z.literal("fails")]).optional(),
  limitGbp: z.string().min(1).optional(),
  holds: z.enum(HELD_CALLS).optional(),
});

type AskingScript = z.output<typeof askingScripting>;

export const askingNamed = z.object({ workspaceId: z.string().min(1) });

type Calls = { judge: number; draft: number };

type Scripted = {
  readonly script: AskingScript;
  readonly held: PromiseWithResolvers<void>;
  readonly calls: Calls;
};

const isDrafting = (body: string): boolean =>
  z.object({ stream: z.literal(true) }).safeParse(JSON.parse(body)).success;

const linesFor = (writes: readonly Written[], prompt: string): readonly string[] => {
  const numbers = conceptNumbersIn(prompt);
  return writes.flatMap(({ citing, sentence }) => {
    const number = numbers.get(citing);
    return number === undefined ? [] : [`${sentence}[^${number}]\n`];
  });
};

const failed = (): Response =>
  new Response("the script says this call fails", { status: FAILED_STATUS });

const drafted = (scripted: Scripted, body: string, signal: AbortSignal | null | undefined) => {
  const { drafting, holds } = scripted.script;
  if (drafting === undefined || drafting === "fails") return failed();
  const events = streamedEventsOf(linesFor(drafting.writes, promptOf(body)));
  const afterTheFirst = events.findIndex((event) => event.includes("text_delta")) + 1;
  return streamedResponse(events, {
    signal,
    before: (at) =>
      holds === "draft" && at === afterTheFirst ? scripted.held.promise : Promise.resolve(),
  });
};

/** A held judge still ends as a real fetch does when its caller aborts. */
const judged = async (
  scripted: Scripted,
  body: string,
  signal: AbortSignal | null | undefined,
): Promise<Response> => {
  const { judging, holds } = scripted.script;
  if (holds === "judge") await Promise.race([scripted.held.promise, endedWith(signal)]);
  if (judging === undefined || judging === "fails") return failed();
  return judgeSaying(judging.fits)({ url: "", headers: undefined, body, signal });
};

export const scriptedModels = () => {
  const scripts = new Map<string, Scripted>();
  const scriptedFor = (init: RequestInit | undefined): Scripted | undefined => {
    const key = new Headers(init?.headers).get("x-api-key") ?? "";
    return key.startsWith(KEY_PREFIX) ? scripts.get(key.slice(KEY_PREFIX.length)) : undefined;
  };
  return {
    fetch: async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const scripted = scriptedFor(init);
      const body = typeof init?.body === "string" ? init.body : "";
      if (scripted === undefined) return new Response("no script", { status: FAILED_STATUS });
      if (isDrafting(body)) {
        scripted.calls.draft += 1;
        return drafted(scripted, body, init?.signal);
      }
      scripted.calls.judge += 1;
      return judged(scripted, body, init?.signal);
    },
    script: (script: AskingScript): void => {
      scripts.set(script.workspaceId, {
        script,
        held: Promise.withResolvers<void>(),
        calls: { judge: 0, draft: 0 },
      });
    },
    release: (workspaceId: string): boolean => {
      const scripted = scripts.get(workspaceId);
      scripted?.held.resolve();
      return scripted !== undefined;
    },
    callsTo: (workspaceId: string): Calls => {
      const calls = scripts.get(workspaceId)?.calls;
      return { judge: calls?.judge ?? 0, draft: calls?.draft ?? 0 };
    },
  };
};

export type ScriptedModels = ReturnType<typeof scriptedModels>;

export const setUpAsking = async (
  app: TestApp,
  models: ScriptedModels,
  script: AskingScript,
): Promise<void> => {
  const { workspaceId, judging, drafting, limitGbp } = script;
  models.script(script);
  // Uncounted, the planner joins every node to every step, and the walk nears its timeout.
  await app.database.superuser.query("ANALYZE map_node, map_edge");
  if (judging === undefined && drafting === undefined) return;
  await judgingSetUp(app, workspaceId, {
    key: keyOf(workspaceId),
    chosen: judging !== undefined,
    drafting: drafting !== undefined,
    ...(limitGbp === undefined ? {} : { limitGbp }),
  });
};
