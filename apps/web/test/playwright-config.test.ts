// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The browser suite's one fence against a focused spec (`[CHECK2]`).
 *
 * The specs import `test` and `expect` from `e2e/browser.ts` rather than from Playwright,
 * so oxlint's vitest rules — which fail a focused test everywhere else — never see them. A
 * `test.only` left behind after a debugging session would run alone in CI and report the
 * suite green for having run one spec. `forbidOnly` under CI is what refuses that, and it
 * is a value in a configuration module, so this is where it can be read.
 *
 * The config is imported twice with the environment differing, because a setting that is
 * always on would fail a local debugging session for no reason and a setting that is always
 * off is not there at all.
 */

const configUnder = async (ci: string | undefined): Promise<{ readonly forbidOnly?: boolean }> => {
  if (ci === undefined) delete process.env["CI"];
  else process.env["CI"] = ci;

  // The value is read when the module body runs, so the previous evaluation must go.
  vi.resetModules();
  return (await import("../playwright.config.ts")).default;
};

const ciBefore = process.env["CI"];

afterEach(() => {
  if (ciBefore === undefined) delete process.env["CI"];
  else process.env["CI"] = ciBefore;
});

describe("the browser suite's configuration (T-068)", () => {
  it("refuses a focused spec when it runs in CI", async () => {
    expect((await configUnder("true")).forbidOnly).toBe(true);
  });

  it("lets a developer focus one spec on their own machine", async () => {
    expect((await configUnder(undefined)).forbidOnly).toBe(false);
  });
});
