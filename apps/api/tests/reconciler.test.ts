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

  it("asks every workspace on the interval, says what each tick found, and stops when told", async () => {
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

  it("never starts a tick while one is running: it says so and waits for the interval after", async () => {
    const head = watched({ pingUrl: undefined });

    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    expect(skips(head.logs)).toHaveLength(1);
    expect(ticks(head.logs)).toHaveLength(0);

    await head.stop();

    expect(ticks(head.logs)).toHaveLength(1);
    expect(skips(head.logs)).toHaveLength(1);
  });

  it("pings the scheduler check once a minute, on every second tick, with the outcome word alone", async () => {
    const head = watched();

    await head.tickTimes(5);
    await head.stop();

    expect(head.pinged).toEqual([
      { url: PING_URL, body: "ok" },
      { url: PING_URL, body: "ok" },
    ]);
  });

  it("lets go of every answer the check gives, so no ping holds a connection open", async () => {
    const head = watched();

    await head.tickTimes(2);
    await head.stop();

    expect(head.answers.map((answered) => answered.bodyUsed)).toEqual([true]);
  });

  it("pings the check's failure for a minute in which a tick failed, and its success once the ticks go well again", async () => {
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

  it("never waits on a slow ping: the ticks go on, and the next minute's ping is sent while the last one hangs", async () => {
    const hanging = Promise.withResolvers<Response>();
    const head = watched({ answer: async () => hanging.promise });

    await head.tickTimes(4);
    await until(async () => head.pinged.length === 2);

    expect(skips(head.logs)).toEqual([]);
    expect(ticks(head.logs)).toHaveLength(4);
    hanging.resolve(new Response(null, { status: 200 }));
    await head.stop();
  });

  it("goes on past a ping that could not be sent, says so once, and never names the check's URL", async () => {
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

  it("says once, with its status, that the check refused a ping, so a re-created check's 404 shows in the log", async () => {
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

  it("still ticks, and pings nothing, when the estate names no check", async () => {
    const head = watched({ pingUrl: undefined });

    await head.tickTimes(2);
    await head.stop();

    expect(ticks(head.logs)).toHaveLength(2);
    expect(head.pinged).toEqual([]);
  });

  it("does not start when the image was never told a repositories' root, and says nothing of its own", () => {
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
