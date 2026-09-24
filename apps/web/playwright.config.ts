import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,

  forbidOnly: Boolean(process.env["CI"]),
  reporter: "list",
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
