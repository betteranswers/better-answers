// @vitest-environment node

import { readFileSync } from "node:fs";

import type { PlaywrightTestConfig } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const PUBLIC_URL = "https://app.better-answers.example";

const journeysConfigAt = async (publicUrl: string | undefined): Promise<PlaywrightTestConfig> => {
  vi.stubEnv("PUBLIC_URL", publicUrl);
  vi.resetModules();
  return (await import("../playwright.journeys.config.ts")).default;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the journeys' configuration", () => {
  it("starts no web server and aims at PUBLIC_URL", async () => {
    const config = await journeysConfigAt(PUBLIC_URL);

    expect(config.webServer).toBeUndefined();
    expect(config.use?.baseURL).toBe(PUBLIC_URL);
  });

  it("runs one journey at a time and never retries", async () => {
    const config = await journeysConfigAt(PUBLIC_URL);

    expect(config.workers).toBe(1);
    expect(config.fullyParallel).toBe(false);
    expect(config.retries).toBe(0);
  });

  it("fails a control that never shows within seconds", async () => {
    const config = await journeysConfigAt(PUBLIC_URL);

    expect(config.use?.actionTimeout).toBe(15_000);
    expect(config.use?.navigationTimeout).toBe(30_000);
  });

  it("records no trace, screenshot or video in any project", async () => {
    const config = await journeysConfigAt(PUBLIC_URL);
    const recorded = (config.projects ?? []).map((project) => {
      const { trace, screenshot, video } = { ...config.use, ...project.use };
      return { trace, screenshot, video };
    });

    expect(recorded).toEqual([
      { trace: "off", screenshot: "off", video: "off" },
      { trace: "off", screenshot: "off", video: "off" },
    ]);
  });

  it("runs the role journeys only after the preflight holds", async () => {
    const config = await journeysConfigAt(PUBLIC_URL);
    const projects = (config.projects ?? []).map(({ name, dependencies, timeout }) => ({
      name,
      dependencies,
      timeout,
    }));

    expect(projects).toEqual([
      { name: "preflight", dependencies: undefined, timeout: 60_000 },
      { name: "roles", dependencies: ["preflight"], timeout: 360_000 },
    ]);
  });

  it("keeps its journeys out of the browser suite's directory", async () => {
    const config = await journeysConfigAt(PUBLIC_URL);
    const suite = (await import("../playwright.config.ts")).default;

    expect(config.testDir).toBe("journeys");
    expect(suite.testDir).toBe("e2e");
  });

  it("refuses a focused journey wherever it runs", async () => {
    expect((await journeysConfigAt(PUBLIC_URL)).forbidOnly).toBe(true);
  });

  it("reports through the outcome reporter alone", async () => {
    const config = await journeysConfigAt(PUBLIC_URL);

    expect(config.reporter).toEqual([
      [
        "./journeys/outcome-reporter.ts",
        { outcomeFile: expect.stringMatching(/test-results\/journeys-outcome$/) },
      ],
    ]);
  });

  it("runs the journeys with Playwright's page snapshot off", () => {
    const manifest = z
      .object({ scripts: z.object({ journeys: z.string() }) })
      .parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")));

    expect(manifest.scripts.journeys).toMatch(/^PLAYWRIGHT_NO_COPY_PROMPT=1 /);
  });

  it.each([undefined, "", "app.better-answers.example"])(
    "refuses to start when PUBLIC_URL is %j",
    async (publicUrl) => {
      await expect(journeysConfigAt(publicUrl)).rejects.toThrow(/PUBLIC_URL/);
    },
  );
});
