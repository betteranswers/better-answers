import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";
import { z } from "zod";

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

const chromium = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "journeys",
  fullyParallel: false,
  workers: 1,

  // A focused journey would run alone and report held.
  forbidOnly: true,

  // Each Send spends a ceiling the release, a rerun and the owner share.
  retries: 0,
  reporter: [
    ["list"],
    [
      "./journeys/outcome-reporter.ts",
      {
        outcomeFile: fileURLToPath(new URL("./test-results/journeys-outcome", import.meta.url)),
      },
    ],
  ],

  // A trace, screenshot or video of a signed-in screen would publish a live session.
  use: { baseURL: publicUrl.data, trace: "off", screenshot: "off", video: "off" },
  projects: [
    {
      name: "preflight",
      testMatch: "preflight.spec.ts",
      timeout: PREFLIGHT_TIMEOUT_MS,
      use: { ...chromium },
    },
    {
      name: "roles",
      testIgnore: "preflight.spec.ts",
      dependencies: ["preflight"],
      timeout: ROLE_JOURNEY_TIMEOUT_MS,
      use: { ...chromium },
    },
  ],
});
