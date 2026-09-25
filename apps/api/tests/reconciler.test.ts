import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initRepository } from "@better-answers/core/store/git";
import { until } from "@better-answers/core/testing/postgres";

import { openDoors, type Doors } from "../src/doors.ts";
import { RECONCILER_INTERVAL_MS, startReconciler } from "../src/reconciler.ts";
import { capturingLogger, openTestGit, type LogLine } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

const CHECK_UUID = "7c1d9e4a-2b6f-4e83-a5d0-9f3c8b1e6a27";

const PING_URL = `https://hc-ping.com/${CHECK_UUID}`;

const TICK_FAILED = "the reconciler tick failed";

const saying = (logs: readonly LogLine[], msg: string): readonly LogLine[] =>
  logs.filter((line) => line["msg"] === msg);

const ticks = (logs: readonly LogLine[]): readonly LogLine[] => saying(logs, "reconciler tick");

const skips = (logs: readonly LogLine[]): readonly LogLine[] =>
  saying(logs, "a reconciler tick was skipped: the previous one is still running");

const finished = (logs: readonly LogLine[]): number =>
  ticks(logs).length + saying(logs, TICK_FAILED).length;

type Pinged = { readonly url: string; readonly body: string };

const answeredOk = async (): Promise<Response> => new Response("OK", { status: 200 });

describe("the periodic head check", () => {
  const app = appForSuite();

  const watched = (
    options: {
      readonly pingUrl?: string | undefined;
      readonly doors?: Doors | undefined;
      readonly answer?: ((nth: number) => Promise<Response>) | undefined;
    } = {},
  ) => {
    const { logger, logs } = capturingLogger("debug");
    const pinged: Pinged[] = [];
    const answers: Response[] = [];
    const answer = options.answer ?? answeredOk;
    const started = startReconciler({
      doors: options.doors ?? app().doors,
      settings: { pingUrl: "pingUrl" in options ? options.pingUrl : PING_URL },
      logger,
      fetch: async (url, init) => {
        const nth = pinged.length;
        pinged.push({ url, body: typeof init.body === "string" ? init.body : "" });
        const answered = await answer(nth);
        answers.push(answered);
        return answered;
      },
    });
    if (!started.ok) throw new Error(`the TestApp's own root was refused: ${started.error}`);
    const reconciler = started.value;

    const tick = async (): Promise<void> => {
      const before = finished(logs);
      vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
      await until(async () => finished(logs) > before);
    };
    const tickTimes = async (count: number): Promise<void> => {
      for (let turn = 0; turn < count; turn += 1) await tick();
    };

    return { logs, pinged, answers, tick, tickTimes, stop: () => reconciler.stop() };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks every workspace each interval, logs each tick, and stops", async () => {
    const held = await app().provision();
    const bare = await app().provision();
    await initRepository(openTestGit(app()), held.workspaceId);
    const head = watched({ pingUrl: undefined });

    expect(ticks(head.logs)).toEqual([]);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    await head.stop();

    expect(ticks(head.logs)).toHaveLength(1);
    expect(ticks(head.logs)[0]).toMatchObject({
      level: 40,
      replayed: 0,
      already_landed: 0,
      stopped: [],
      refused: [{ workspace_id: bare.workspaceId, reason: "no-such-repository" }],
    });

    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS * 3);
    expect(ticks(head.logs)).toHaveLength(1);
  });

  it("never overlaps a tick, logging the skip and waiting", async () => {
    const head = watched({ pingUrl: undefined });

    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    expect(skips(head.logs)).toHaveLength(1);
    expect(ticks(head.logs)).toHaveLength(0);

    await head.stop();

    expect(ticks(head.logs)).toHaveLength(1);
    expect(skips(head.logs)).toHaveLength(1);
  });

  it("pings the scheduler check every minute, with the outcome alone", async () => {
    const head = watched();

    await head.tickTimes(5);
    await head.stop();

    expect(head.pinged).toEqual([
      { url: PING_URL, body: "ok" },
      { url: PING_URL, body: "ok" },
    ]);
  });

  it("consumes every ping's answer, so no connection stays open", async () => {
    const head = watched();

    await head.tickTimes(2);
    await head.stop();

    expect(head.answers.map((answered) => answered.bodyUsed)).toEqual([true]);
  });

  it("pings failure for a failed minute, then success once recovered", async () => {
    const runtimeRole = app().database.pool.options;
    const pool = new Pool({ ...runtimeRole, max: 1, connectionTimeoutMillis: 250 });
    const holder = await pool.connect();
    let held = true;
    const release = (): void => {
      if (held) holder.release();
      held = false;
    };
    try {
      const head = watched({
        doors: openDoors({ database: pool, gitStoreDir: app().gitStoreDir }),
      });

      await head.tick();
      expect(saying(head.logs, TICK_FAILED)).toEqual([expect.objectContaining({ level: 50 })]);
      release();
      await head.tickTimes(3);
      await head.stop();

      expect(ticks(head.logs)).toHaveLength(3);
      expect(head.pinged).toEqual([
        { url: `${PING_URL}/fail`, body: "fail" },
        { url: PING_URL, body: "ok" },
      ]);
    } finally {
      release();
      await pool.end();
    }
  });

  it("never waits on a slow ping; ticks and pings continue", async () => {
    const hanging = Promise.withResolvers<Response>();
    const head = watched({ answer: async () => hanging.promise });

    await head.tickTimes(4);
    await until(async () => head.pinged.length === 2);

    expect(skips(head.logs)).toEqual([]);
    expect(ticks(head.logs)).toHaveLength(4);
    hanging.resolve(new Response(null, { status: 200 }));
    await head.stop();
  });

  it("goes past an unsent ping, logging once without the URL", async () => {
    const head = watched({
      answer: async (nth) => {
        if (nth === 0) throw new TypeError("fetch failed");
        return answeredOk();
      },
    });

    await head.tickTimes(4);
    await head.stop();

    expect(head.pinged).toHaveLength(2);
    expect(saying(head.logs, "a dead-man ping could not be sent")).toEqual([
      expect.objectContaining({ level: 40, check: "scheduler", reason: "fetch failed" }),
    ]);
    expect(JSON.stringify(head.logs)).not.toContain(CHECK_UUID);
  });

  it("logs a refused ping's status once, so a 404 shows", async () => {
    const head = watched({
      answer: async (nth) =>
        nth === 0 ? new Response("not found", { status: 404 }) : answeredOk(),
    });

    await head.tickTimes(4);
    await head.stop();

    expect(head.pinged).toHaveLength(2);
    expect(saying(head.logs, "a dead-man ping was refused")).toEqual([
      expect.objectContaining({ level: 40, check: "scheduler", status: 404 }),
    ]);
    expect(JSON.stringify(head.logs)).not.toContain(CHECK_UUID);
  });

  it("still ticks, pinging nothing, when the estate names no check", async () => {
    const head = watched({ pingUrl: undefined });

    await head.tickTimes(2);
    await head.stop();

    expect(ticks(head.logs)).toHaveLength(2);
    expect(head.pinged).toEqual([]);
  });

  it("refuses to start without a repositories' root, logging nothing", () => {
    const { logger, logs } = capturingLogger();

    const refused = startReconciler({
      doors: openDoors({ database: app().database.pool }),
      settings: { pingUrl: PING_URL },
      logger,
    });

    expect(refused).toEqual({ ok: false, error: "no-bundle-store" });
    expect(logs).toEqual([]);
  });
});
