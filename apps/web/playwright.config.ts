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
    command: `pnpm --filter @better-answers/api run serve:e2e ${PORT}`,

    url: `${baseURL}/health`,

    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
