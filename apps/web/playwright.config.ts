import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
/** The api's own public address: a passkey's relying party must be a domain, never an IP. */
const baseURL = `http://localhost:${PORT}`;

const inCi = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,

  forbidOnly: inCi,

  // A retry keeps one flake from ejecting a merge-queue entry, and the flaky report names it.
  // On a developer's machine a failure stays a failure.
  retries: inCi ? 1 : 0,
  reporter: [["list"], ["./e2e/flaky-report.ts"]],
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Not `pnpm run`: pnpm 11.27 gives a script its own process group, which Playwright's
    // kill misses, and the orphan's open pipe hangs the run.
    command: `node tests/serve.ts ${PORT}`,
    cwd: fileURLToPath(new URL("../api", import.meta.url)),

    url: `${baseURL}/health`,

    // A cold Testcontainers Postgres pulls its image before it answers anything.
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
