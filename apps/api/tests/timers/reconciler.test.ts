import { Pool, type PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initRepository } from "@better-answers/core/store/git";
import { until } from "@better-answers/core/testing/postgres";
import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { matching } from "@better-answers/schema/testing/matching";

import { openDoors, type Doors } from "../../src/doors.ts";
import { RECONCILER_INTERVAL_MS, startReconciler } from "../../src/timers/reconciler.ts";
import { capturingLogger, openTestGit, type LogLine } from "../support/harness/harness.ts";
import { appForSuite } from "../support/suite-app.ts";

const CHECK_UUID = "7c1d9e4a-2b6f-4e83-a5d0-9f3c8b1e6a27";

const PING_URL = `https://hc-ping.com/${CHECK_UUID}`;

const TICK_FAILED = "the reconciler tick failed";

const FOLLOWING_FAILED = "the sync cascade tick failed";

const saying = (logs: readonly LogLine[], msg: string): readonly LogLine[] =>
  logs.filter((line) => line["msg"] === msg);

const ticks = (logs: readonly LogLine[]): readonly LogLine[] => saying(logs, "reconciler tick");

const skips = (logs: readonly LogLine[]): readonly LogLine[] =>
  saying(logs, "a reconciler tick was skipped: the previous one is still running");

const finished = (logs: readonly LogLine[]): number =>
  saying(logs, "sync cascade tick").length + saying(logs, FOLLOWING_FAILED).length;

type Pinged = { readonly url: string; readonly body: string };

const answeredOk = async (): Promise<Response> => new Response("OK", { status: 200 });

const firstThenOk =
  (first: () => Promise<Response>) =>
  async (nth: number): Promise<Response> =>
    nth === 0 ? first() : answeredOk();

const releasedOnce = (holder: PoolClient): (() => void) => {
  let held = true;
  return () => {
    if (held) holder.release();
    held = false;
  };
};

const syncThatMovedNothing = (client: PoolClient, workspaceId: string, id: string) => {
  const at = new Date(Date.now() - 60_000);
  return testData(client).job({
    id,
    workspaceId,
    kind: "index",
    subjectId: ulid(),
    reason: "rule-change",
    status: "done",
    enqueuedAt: at,
    attempts: 1,
    claimedBy: "worker-1",
    claimedAt: at,
    heartbeatAt: at,
    finishedAt: at,
    outcome: { passages: 0, sensitivity_moved: [] },
  });
};

describe("the reconciler's periodic tick", () => {
  const app = appForSuite();

  const startTestReconciler = (
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

  const holdBundleLock = async (workspaceId: string) => {
    const holder = await app().database.superuser.connect();
    await holder.query("SELECT pg_advisory_lock(hashtext('bundle'), hashtext($1))", [workspaceId]);
    return async (): Promise<void> => {
      await holder.query("SELECT pg_advisory_unlock(hashtext('bundle'), hashtext($1))", [
        workspaceId,
      ]);
      holder.release();
    };
  };

  const tickWithBundleLocked = async (): Promise<{
    readonly lines: readonly LogLine[];
    readonly heldId: string;
  }> => {
    const held = await app().provision();
    await initRepository(openTestGit(app()), held.workspaceId);
    const release = await holdBundleLock(held.workspaceId);
    const reconciler = startTestReconciler({ pingUrl: undefined });
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    await reconciler.stop();
    await release();
    return { lines: ticks(reconciler.logs), heldId: held.workspaceId };
  };

  it("logs a workspace with a held bundle lock at info", async () => {
    const { lines, heldId } = await tickWithBundleLocked();

    expect(lines).toEqual([
      matching.objectContaining({
        level: 30,
        held: [{ workspace_id: heldId }],
        refused: [],
      }),
    ]);
  });

  it("checks every workspace once per interval and stops when told", async () => {
    const held = await app().provision();
    const bare = await app().provision();
    await initRepository(openTestGit(app()), held.workspaceId);
    const reconciler = startTestReconciler({ pingUrl: undefined });

    expect(ticks(reconciler.logs)).toEqual([]);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    await reconciler.stop();

    expect(ticks(reconciler.logs)).toHaveLength(1);
    expect(ticks(reconciler.logs)[0]).toMatchObject({
      level: 40,
      replayed: 0,
      already_landed: 0,
      stopped: [],
      refused: [{ workspace_id: bare.workspaceId, reason: "no-such-repository" }],
    });

    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS * 3);
    expect(ticks(reconciler.logs)).toHaveLength(1);
  });

  it("logs at warn when a refusal accompanies a locked bundle", async () => {
    const bare = await app().provision();

    const { lines, heldId } = await tickWithBundleLocked();

    expect(lines[0]).toMatchObject({
      level: 40,
      held: [{ workspace_id: heldId }],
      refused: matching.arrayContaining([
        { workspace_id: bare.workspaceId, reason: "no-such-repository" },
      ]),
    });
  });

  it("runs the sync cascade for a workspace the reconciler refuses", async () => {
    const bare = await app().provision();
    const client = await app().database.superuser.connect();
    try {
      await syncThatMovedNothing(client, bare.workspaceId, ulid());
    } finally {
      client.release();
    }
    const reconciler = startTestReconciler({ pingUrl: undefined });

    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    await reconciler.stop();

    expect(ticks(reconciler.logs)[0]).toMatchObject({
      level: 40,
      refused: matching.arrayContaining([
        { workspace_id: bare.workspaceId, reason: "no-such-repository" },
      ]),
    });
    expect(saying(reconciler.logs, "sync cascade tick")).toEqual([
      matching.objectContaining({ level: 30, followed: 1, concepts: 0, skipped: [], refused: [] }),
    ]);
  });

  it("pings failure when the sync cascade skips a job", async () => {
    const bare = await app().provision();
    const jobId = ulid();
    const name = `refuse_marker_${jobId.toLowerCase()}`;
    const client = await app().database.superuser.connect();
    try {
      await syncThatMovedNothing(client, bare.workspaceId, jobId);
      await client.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.subject_id = '${jobId}' THEN RAISE EXCEPTION 'the marker is refused'; END IF;
           RETURN NEW;
         END $$`,
      );
      await client.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      const reconciler = startTestReconciler();

      await reconciler.tickTimes(2);
      await reconciler.stop();

      expect(saying(reconciler.logs, "sync cascade tick")[0]).toMatchObject({
        level: 40,
        skipped: [{ workspace_id: bare.workspaceId, job_id: jobId }],
      });
      expect(reconciler.pinged).toEqual([{ url: `${PING_URL}/fail`, body: "fail" }]);
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${name} ON audit_event`);
      await client.query(`DROP FUNCTION IF EXISTS ${name}()`);
      client.release();
    }
  });

  it("skips and logs a tick while the previous one runs", async () => {
    const reconciler = startTestReconciler({ pingUrl: undefined });

    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    expect(skips(reconciler.logs)).toHaveLength(1);
    expect(ticks(reconciler.logs)).toHaveLength(0);

    await reconciler.stop();

    expect(ticks(reconciler.logs)).toHaveLength(1);
    expect(skips(reconciler.logs)).toHaveLength(1);
  });

  it("pings the scheduler check each minute with only the outcome", async () => {
    const reconciler = startTestReconciler();

    await reconciler.tickTimes(5);
    await reconciler.stop();

    expect(reconciler.pinged).toEqual([
      { url: PING_URL, body: "ok" },
      { url: PING_URL, body: "ok" },
    ]);
  });

  it("reads every ping response body so no connection stays open", async () => {
    const reconciler = startTestReconciler();

    await reconciler.tickTimes(2);
    await reconciler.stop();

    expect(reconciler.answers.map((answered) => answered.bodyUsed)).toEqual([true]);
  });

  it("pings failure when a tick fails, then success after recovery", async () => {
    const runtimeRole = app().database.pool.options;
    const pool = new Pool({ ...runtimeRole, max: 1 });
    const holder = await pool.connect();
    // pg-pool reads this on each connect. Set it after the holder connects so a slow runner cannot time out that login.
    pool.options.connectionTimeoutMillis = 250;
    const release = releasedOnce(holder);
    try {
      const reconciler = startTestReconciler({
        doors: openDoors({ database: pool, gitStoreDir: app().gitStoreDir }),
      });

      await reconciler.tick();
      expect(saying(reconciler.logs, TICK_FAILED)).toEqual([
        matching.objectContaining({ level: 50 }),
      ]);
      expect(saying(reconciler.logs, FOLLOWING_FAILED)).toEqual([
        matching.objectContaining({ level: 50 }),
      ]);
      release();
      await reconciler.tickTimes(3);
      await reconciler.stop();

      expect(ticks(reconciler.logs)).toHaveLength(3);
      expect(reconciler.pinged).toEqual([
        { url: `${PING_URL}/fail`, body: "fail" },
        { url: PING_URL, body: "ok" },
      ]);
    } finally {
      release();
      await pool.end();
    }
  });

  it("keeps ticking and pinging while an earlier ping hangs", async () => {
    const hanging = Promise.withResolvers<Response>();
    const reconciler = startTestReconciler({ answer: async () => hanging.promise });

    await reconciler.tickTimes(4);
    await until(async () => reconciler.pinged.length === 2);

    expect(skips(reconciler.logs)).toEqual([]);
    expect(ticks(reconciler.logs)).toHaveLength(4);
    hanging.resolve(new Response(null, { status: 200 }));
    await reconciler.stop();
  });

  it("logs an unsent ping once without the URL and continues", async () => {
    const reconciler = startTestReconciler({
      answer: firstThenOk(async () => {
        throw new TypeError("fetch failed");
      }),
    });

    await reconciler.tickTimes(4);
    await reconciler.stop();

    expect(reconciler.pinged).toHaveLength(2);
    expect(saying(reconciler.logs, "a dead-man ping could not be sent")).toEqual([
      matching.objectContaining({ level: 40, check: "scheduler", reason: "fetch failed" }),
    ]);
    expect(JSON.stringify(reconciler.logs)).not.toContain(CHECK_UUID);
  });

  it("logs a refused ping's status once, without the URL", async () => {
    const reconciler = startTestReconciler({
      answer: firstThenOk(async () => new Response("not found", { status: 404 })),
    });

    await reconciler.tickTimes(4);
    await reconciler.stop();

    expect(reconciler.pinged).toHaveLength(2);
    expect(saying(reconciler.logs, "a dead-man ping was refused")).toEqual([
      matching.objectContaining({ level: 40, check: "scheduler", status: 404 }),
    ]);
    expect(JSON.stringify(reconciler.logs)).not.toContain(CHECK_UUID);
  });

  it("ticks without pinging when no check URL is configured", async () => {
    const reconciler = startTestReconciler({ pingUrl: undefined });

    await reconciler.tickTimes(2);
    await reconciler.stop();

    expect(ticks(reconciler.logs)).toHaveLength(2);
    expect(reconciler.pinged).toEqual([]);
  });

  it("refuses to start without a bundle store and logs nothing", () => {
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
