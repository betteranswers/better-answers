import { fileURLToPath } from "node:url";

import { afterAll, beforeAll } from "vitest";

import { startApp, type TestApp } from "./harness.ts";

/**
 * An app serving the SPA build, started once for a suite and stopped after it.
 *
 * Two suites need one — the one that asserts what a browser gets from `app.` and the one
 * that drives `pnpm ops`'s smoke command against a running product — and both need it built
 * the same way, because a smoke check that passed against a differently-served shell would
 * be checking something the estate never runs.
 *
 * It hands back a getter rather than the app, because the app does not exist until vitest
 * runs `beforeAll`: a suite that held the value at module scope would hold `undefined`.
 * Reading it outside a test is a throw and never a silence.
 */

/** The fixture build: enough of a shell for a suite to find it. */
const WEB_ROOT = fileURLToPath(new URL("fixtures/web-build", import.meta.url));

export const servedApp = (): (() => TestApp) => {
  let started: TestApp | undefined;

  beforeAll(async () => {
    started = await startApp({ webRoot: WEB_ROOT });
  });

  afterAll(async () => {
    await started?.stop();
  });

  return () => {
    if (started === undefined) {
      throw new Error("the served app is read before beforeAll has started it");
    }
    return started;
  };
};
