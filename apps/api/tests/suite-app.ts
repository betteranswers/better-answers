import { fileURLToPath } from "node:url";

import { afterAll, beforeAll } from "vitest";

import { startApp, type TestApp, type TestAppOptions } from "./harness.ts";

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
      throw new Error("the app is read before beforeAll has started it");
    }
    return started;
  };
};

const WEB_ROOT = fileURLToPath(new URL("fixtures/web-build", import.meta.url));

export const servedApp = (): (() => TestApp) => appForSuite({ webRoot: WEB_ROOT });
