import { defineConfig, devices } from "@playwright/test";

/**
 * The browser-to-product seam: the served build, driven by a real browser.
 *
 * The server is the app tier's own harness (`apps/api/tests/serve.ts`) — the server factory
 * over a Testcontainers Postgres, the email sender capturing codes, the CIMD transport in
 * process — started as a process rather than imported, so `apps/web` still imports nothing
 * from `apps/api` at runtime (ADR 0006).
 *
 * The port is pinned here because this is the side that chooses it, and it is passed to the
 * server as its one argument.
 */

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter @better-answers/api run serve:e2e ${PORT}`,
    // `/health` is the one path the loopback carries whatever else changes, and it answers
    // only once the database is migrated and the authorization server has initialised.
    url: `${baseURL}/health`,
    // A cold Testcontainers Postgres pulls its image before it answers anything.
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
