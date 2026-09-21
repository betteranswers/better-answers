import { afterEach, describe, expect, it, vi } from "vitest";

import { systemClock } from "@better-answers/core/kernel";
import { initRepository } from "@better-answers/core/store/git";

import { RECONCILER_INTERVAL_MS, startReconciler } from "../src/reconciler.ts";
import { capturingLogger, openTestGit, type LogLine } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

const ticks = (logs: readonly LogLine[]): readonly LogLine[] =>
  logs.filter((line) => line["msg"] === "reconciler tick");

const skips = (logs: readonly LogLine[]): readonly LogLine[] =>
  logs.filter(
    (line) => line["msg"] === "a reconciler tick was skipped: the previous one is still running",
  );

describe("the periodic head check", () => {
  const app = appForSuite();

  const running = (logger: Parameters<typeof startReconciler>[0]["logger"]) => {
    const started = startReconciler({
      database: app().database.pool,
      gitStoreDir: app().gitStoreDir,
      logger,
      clock: systemClock(),
    });
    if (!started.ok) throw new Error(`the app's own root was refused: ${started.error}`);
    return started.value;
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks every workspace on the interval, says what each tick found, and stops when told", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const held = await app().provision();
    const bare = await app().provision();
    await initRepository(openTestGit(app()), held.workspaceId);
    const { logger, logs } = capturingLogger("debug");
    const reconciler = running(logger);

    expect(ticks(logs)).toEqual([]);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    await reconciler.stop();

    expect(ticks(logs)).toHaveLength(1);
    expect(ticks(logs)[0]).toMatchObject({
      level: 40,
      replayed: 0,
      already_landed: 0,
      stopped: [],
      refused: [{ workspace_id: bare.workspaceId, reason: "no-such-repository" }],
    });

    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS * 3);
    expect(ticks(logs)).toHaveLength(1);
  });

  it("never starts a tick while one is running: it says so and waits for the interval after", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { logger, logs } = capturingLogger("debug");
    const reconciler = running(logger);

    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    vi.advanceTimersByTime(RECONCILER_INTERVAL_MS);
    expect(skips(logs)).toHaveLength(1);
    expect(ticks(logs)).toHaveLength(0);

    await reconciler.stop();

    expect(ticks(logs)).toHaveLength(1);
    expect(skips(logs)).toHaveLength(1);
  });

  it("cannot start when the repositories' root names a missing directory: the boot hears the door's refusal", () => {
    const { logger, logs } = capturingLogger();

    const refused = startReconciler({
      database: app().database.pool,
      gitStoreDir: `${app().gitStoreDir}/does-not-exist`,
      logger,
      clock: systemClock(),
    });

    expect(refused).toEqual({ ok: false, error: "no-such-root" });
    expect(logs).toEqual([]);
  });
});
