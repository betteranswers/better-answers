import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";
import { z } from "zod";

/**
 * Knip loads any config a script names, so the journeys script starts Playwright by path, and
 * knip.config.ts lists the journeys' entries itself.
 */
const publicUrl = z.url({ protocol: /^https?$/ }).safeParse(process.env["PUBLIC_URL"]);
if (!publicUrl.success) {
  throw new Error(
    "The journeys sign in to the release at PUBLIC_URL, which is not set to an http or https address.",
  );
}

/** The preflight signs nobody in: the health check, the sign-in screen and one inbox list. */
const PREFLIGHT_TIMEOUT_MS = 60_000;

/** A sign-in may wait 150 s on the test inbox; the rest is the journey's screens. */
const ROLE_JOURNEY_TIMEOUT_MS = 360_000;

export default defineConfig({
  testDir: "journeys",
  fullyParallel: false,
  workers: 1,

  // A focused journey would run alone and report held.
  forbidOnly: true,

  // Each Send spends a ceiling the release, a rerun and the owner share.
  retries: 0,

  // Alone, so no reporter prints a failure's detail, which can hold an address, to a public log.
  reporter: [
    [
      "./journeys/outcome-reporter.ts",
      {
        outcomeFile: fileURLToPath(new URL("./test-results/journeys-outcome", import.meta.url)),
      },
    ],
  ],

  use: {
    ...devices["Desktop Chrome"],
    baseURL: publicUrl.data,

    // A control that never shows fails its step in seconds, not at the journey's own timeout.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    // A trace, screenshot or video of a signed-in screen would publish a live session.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "preflight", testMatch: "preflight.spec.ts", timeout: PREFLIGHT_TIMEOUT_MS },
    {
      name: "roles",
      testIgnore: "preflight.spec.ts",
      dependencies: ["preflight"],
      timeout: ROLE_JOURNEY_TIMEOUT_MS,
    },
  ],
});
