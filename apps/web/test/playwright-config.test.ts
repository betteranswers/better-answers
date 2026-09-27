// @vitest-environment node

import type { PlaywrightTestConfig } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

const configUnder = async (ci: string | undefined): Promise<PlaywrightTestConfig> => {
  if (ci === undefined) delete process.env["CI"];
  else process.env["CI"] = ci;

  vi.resetModules();
  return (await import("../playwright.config.ts")).default;
};

const ciBefore = process.env["CI"];

afterEach(() => {
  if (ciBefore === undefined) delete process.env["CI"];
  else process.env["CI"] = ciBefore;
});

describe("the browser suite's configuration", () => {
  it("refuses a focused spec when it runs in CI", async () => {
    expect((await configUnder("true")).forbidOnly).toBe(true);
  });

  it("lets a developer focus one spec on their own machine", async () => {
    expect((await configUnder(undefined)).forbidOnly).toBe(false);
  });

  it("retries a failed spec once when it runs in CI", async () => {
    expect((await configUnder("true")).retries).toBe(1);
  });

  it("never retries a failed spec on a developer's machine", async () => {
    expect((await configUnder(undefined)).retries).toBe(0);
  });

  it("hands every run to the flaky report", async () => {
    expect((await configUnder("true")).reporter).toContainEqual(["./e2e/flaky-report.ts"]);
  });
});
