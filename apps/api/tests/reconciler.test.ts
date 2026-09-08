import { afterEach, describe, expect, it, vi } from "vitest";

import { systemClock } from "@better-answers/core/kernel";
import { initRepository, openGit } from "@better-answers/core/store/git";

import { RECONCILER_INTERVAL_MS, startReconciler } from "../src/reconciler.ts";
import { capturingLogger, type LogLine } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

/**
 * The periodic head check as the api process runs it (T-056; ADR 0012, amended
 * 2026-09-06): the trigger, its guard and its stop, against the real slice over a real,
 * migrated Postgres and this app's own repositories' root. What a replay lands is proved
 * at the slice's seam (`packages/core/test/reconciler.test.ts`); what is held here is that
 * the api asks on the interval, asks once at a time, says what it found, and stops when
 * told. The clock is faked for the interval alone, so a tick is fired by the test and never
 * waited for — no sleep, no race — while the database and the git binary stay real.
 */

const ticks = (logs: readonly LogLine[]): readonly LogLine[] =>
  logs.filter((line) => line["msg"] === "reconciler tick");

const skips = (logs: readonly LogLine[]): readonly LogLine[] =>
  logs.filter(
    (line) => line["msg"] === "a reconciler tick was skipped: the previous one is still running",
  );

describe("the periodic head check", () => {
  const app = appForSuite();

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks every workspace on the interval, says what each tick found, and stops when told", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const held = await app().provision();
    const bare = await app().provision();
    await initRepository(openGit(app().gitStoreDir), held.workspaceId);
    const { logger, logs } = capturingLogger("debug");
    const reconciler = startReconciler({
      database: app().database.pool,
      gitStoreDir: app().gitStoreDir,
      logger,
      clock: systemClock(),
    });

    // Nothing before the first interval: starting is not a tick.
    expect(ticks(logs)).toEqual([]);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    await reconciler.stop();

    // One tick, one line: the bundle with a repository had nothing missed; the one with no
    // repository is that workspace's refusal, worth a warning, and never the tick's failure.
    expect(ticks(logs)).toHaveLength(1);
    expect(ticks(logs)[0]).toMatchObject({
      level: 40,
      replayed: 0,
      already_landed: 0,
      stopped: [],
      refused: [{ workspace_id: bare.workspaceId, reason: "no-such-repository" }],
    });
    // Stopped means stopped: the interval may pass any number of times.
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS * 3);
    expect(ticks(logs)).toHaveLength(1);
  });

  it("never starts a tick while one is running: it says so and waits for the interval after", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { logger, logs } = capturingLogger("debug");
    const reconciler = startReconciler({
      database: app().database.pool,
      gitStoreDir: app().gitStoreDir,
      logger,
      clock: systemClock(),
    });

    // The first tick is in flight — it is asking Postgres — when the interval fires again.
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    expect(skips(logs)).toHaveLength(1);
    expect(ticks(logs)).toHaveLength(0);

    await reconciler.stop();

    expect(ticks(logs)).toHaveLength(1);
    expect(skips(logs)).toHaveLength(1);
  });
});
