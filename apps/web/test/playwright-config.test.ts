// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const configUnder = async (ci: string | undefined): Promise<{ readonly forbidOnly?: boolean }> => {
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
});
