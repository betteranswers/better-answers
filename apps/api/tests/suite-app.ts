import { fileURLToPath } from "node:url";

import { afterAll, beforeAll } from "vitest";

import { startApp, type TestApp, type TestAppOptions } from "./harness.ts";

/**
 * An app started once for a suite and stopped after it.
 *
 * Every suite that drives the real server over a real Postgres wants the same three things —
 * start it before the first test, stop it after the last, and read it in between — and each
 * was writing them out. The generous start timeout is part of the fact: the first suite in a
 * run pays for pulling and migrating a container, and a suite that inherited the default
 * would fail on a cold machine and pass on a warm one.
 *
 * It hands back a getter rather than the app, because the app does not exist until vitest
 * runs `beforeAll`: a suite that held the value at module scope would hold `undefined`.
 * Reading it outside a test is a throw and never a silence.
 */
export const appForSuite = (options: TestAppOptions = {}): (() => TestApp) => {
  let started: TestApp | undefined;

  beforeAll(async () => {
    started = await startApp(options);
  }, 180_000);

  afterAll(async () => {
    await started?.stop();
  });

  return () => {
    if (started === undefined) {
      throw new Error("the app is read before beforeAll has started it");
    }
    return started;
  };
};

/** The fixture build: enough of a shell for a suite to find it. */
const WEB_ROOT = fileURLToPath(new URL("fixtures/web-build", import.meta.url));

/**
 * An app serving the SPA build.
 *
 * Two suites need one — the one that asserts what a browser gets from `app.` and the one
 * that drives `pnpm ops`'s smoke command against a running product — and both need it served
 * from the same root, because a smoke check that passed against a differently-served shell
 * would be checking something the estate never runs. That root is the fact this adds.
 */
export const servedApp = (): (() => TestApp) => appForSuite({ webRoot: WEB_ROOT });
