import { createServer } from "node:net";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { repositoryRoot } from "./test/support/roots.ts";

const inCi = Boolean(process.env["CI"]);

const aFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

/** Playwright evaluates this file in the runner and again in each worker, which inherits the runner's environment and so its port. */
process.env["E2E_PORT"] ??= inCi ? "3100" : String(await aFreePort());
const PORT = Number(process.env["E2E_PORT"]);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`E2E_PORT must be a port number, not "${process.env["E2E_PORT"]}"`);
}
/** The api's own public address: a passkey's relying party must be a domain, never an IP. */
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,

  forbidOnly: inCi,

  retries: inCi ? 1 : 0,

  // Three of the runner's four cores: the api, Postgres and the browser's own processes take the fourth.
  ...(inCi ? { workers: 3 } : {}),
  reporter: [["list"], ["./e2e/run-summary.ts"]],
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Not `pnpm run`: pnpm 11.27 gives a script its own process group, which Playwright's
    // kill misses, and the orphan's open pipe hangs the run.
    command: `node tests/serve.ts ${PORT}`,
    cwd: path.join(repositoryRoot, "apps/api"),

    url: `${baseURL}/health`,

    // A cold Testcontainers Postgres pulls its image before it answers anything.
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
