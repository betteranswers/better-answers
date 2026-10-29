// @vitest-environment node

import type { PlaywrightTestConfig } from "@playwright/test";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

const SETTINGS = ["CI", "E2E_PORT", "E2E_GATE_ALONE"] as const;
type Settings = Partial<Record<(typeof SETTINGS)[number], string>>;

const before: Settings = Object.fromEntries(SETTINGS.map((name) => [name, process.env[name]]));

const setAll = (settings: Settings): void => {
  for (const name of SETTINGS) {
    const value = settings[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

const configWith = async (settings: Settings): Promise<PlaywrightTestConfig> => {
  setAll(settings);
  vi.resetModules();
  // oxlint-disable-next-line no-restricted-imports -- the config sits at the web's root, which no `@/<zone>` alias reaches
  return (await import("../../playwright.config.ts")).default;
};

const configUnder = (ci: string | undefined): Promise<PlaywrightTestConfig> =>
  configWith(ci === undefined ? {} : { CI: ci });

const portOf = (config: PlaywrightTestConfig): number =>
  Number(new URL(config.use?.baseURL ?? "").port);

afterEach(() => {
  setAll(before);
});

describe("the browser suite's configuration", () => {
  it("refuses a focused spec when it runs in CI", async () => {
    expect((await configUnder("true")).forbidOnly).toBe(true);
  });

  it("lets a developer focus one spec on their own machine", async () => {
    expect((await configUnder(undefined)).forbidOnly).toBe(false);
  });

  it("retries once in CI so flakes keep their queue entry", async () => {
    expect((await configUnder("true")).retries).toBe(1);
  });

  it("never retries a failed spec on a developer's machine", async () => {
    expect((await configUnder(undefined)).retries).toBe(0);
  });

  it("runs three workers when it runs in CI", async () => {
    expect((await configUnder("true")).workers).toBe(3);
  });

  it("keeps Playwright's own worker count on a developer's machine", async () => {
    expect((await configUnder(undefined)).workers).toBeUndefined();
  });

  it("hands every run to the run summary", async () => {
    expect((await configUnder("true")).reporter).toContainEqual(["./e2e/run-summary.ts"]);
  });
});

describe("the browser suite's port", () => {
  it("is 3100 when it runs in CI", async () => {
    expect(portOf(await configUnder("true"))).toBe(3100);
  });

  it("leaves 3100 free on a developer's machine", async () => {
    expect(portOf(await configUnder(undefined))).not.toBe(3100);
  });

  it("hands its port to the workers through E2E_PORT", async () => {
    const port = portOf(await configUnder(undefined));

    expect(process.env["E2E_PORT"]).toBe(String(port));
  });

  it("gives a worker the port its runner took", async () => {
    const port = portOf(await configUnder(undefined));

    expect(portOf(await configWith({ E2E_PORT: String(port) }))).toBe(port);
  });

  it("is the one E2E_PORT names, even in CI", async () => {
    expect(portOf(await configWith({ CI: "true", E2E_PORT: "4321" }))).toBe(4321);
  });

  it("refuses an E2E_PORT that is not a port", async () => {
    await expect(configWith({ E2E_PORT: "43a1" })).rejects.toThrow(/E2E_PORT/);
  });

  it("is the port the server starts on and answers", async () => {
    const config = await configUnder(undefined);
    const server = config.webServer;
    const port = portOf(config);

    assert(!Array.isArray(server), "the config starts one web server");
    assert(server !== undefined, "the config starts a web server");
    expect(server.command).toMatch(new RegExp(` ${port}$`));
    expect(server.url).toBe(`http://localhost:${port}/health`);
  });
});

describe("the accessibility gate's project", () => {
  const GATE_SPEC = "accessibility-gate.spec.ts";

  it("keeps the gate's spec in a project of its own", async () => {
    const { projects } = await configUnder(undefined);

    expect(projects).toEqual([
      expect.objectContaining({ name: "chromium", testIgnore: GATE_SPEC }),
      expect.objectContaining({ name: "gate", testMatch: GATE_SPEC }),
    ]);
  });

  it("serves the gate alone from the build, with no api", async () => {
    const config = await configWith({ E2E_GATE_ALONE: "1" });
    const server = config.webServer;
    const port = portOf(config);

    expect(config.projects?.map((project) => project.name)).toEqual(["gate"]);
    assert(!Array.isArray(server), "the config starts one web server");
    assert(server !== undefined, "the config starts a web server");
    expect(server.command).toContain("vite.js preview");
    expect(server.command).not.toContain("serve.ts");
    expect(server.command).toMatch(new RegExp(`--port ${port} `));
  });
});
