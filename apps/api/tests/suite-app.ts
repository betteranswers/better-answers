import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll } from "vitest";

import type { Clock } from "@better-answers/core/kernel";

import { startApp, type TestApp, type TestAppOptions } from "./harness.ts";

/**
 * Registers `beforeAll` and `afterAll` hooks that start and stop one TestApp; the getter throws
 * until the first has run.
 */
export const appForSuite = (options: TestAppOptions = {}): (() => TestApp) => {
  let started: TestApp | undefined;

  beforeAll(async () => {
    started = await startApp(options);
  });

  afterAll(async () => {
    await started?.stop();
  });

  return () => {
    if (started === undefined) {
      throw new Error("the TestApp is read before beforeAll has started it");
    }
    return started;
  };
};

/** Stopped while a test counts past a ceiling: on the wall clock its asks can straddle two fixed windows. */
export const aStoppableClock = (): { readonly clock: Clock; readonly stopTheClock: () => void } => {
  const stopped: { at: number | undefined } = { at: undefined };

  afterEach(() => {
    stopped.at = undefined;
  });

  return {
    clock: { now: () => new Date(stopped.at ?? Date.now()) },
    stopTheClock: () => {
      stopped.at = Date.now();
    },
  };
};

const WEB_ROOT = fileURLToPath(new URL("fixtures/web-build", import.meta.url));

/** As `appForSuite`, with the fixture web build served. */
export const servedApp = (): (() => TestApp) => appForSuite({ webRoot: WEB_ROOT });
