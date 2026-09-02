/**
 * Mutation testing for this workspace ([TEST6]), run weekly by .github/workflows/mutation.yml.
 *
 * @type {import("@stryker-mutator/api/core").PartialStrykerOptions}
 */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.config.ts" },

  // `main.tsx` mounts the app into the document; there is no seam under it to test.
  // `e2e/` is named as excluded rather than merely left out: the browser suite is driven by
  // Playwright against a served build over a Testcontainers Postgres, and the vitest runner
  // below cannot run it, so a mutant there would be reported as survived for ever.
  mutate: ["src/**/*.tsx", "!src/main.tsx", "!e2e/**"],
  coverageAnalysis: "perTest",

  // Stryker's sandbox copies the workspace to a temp directory and rewrites `extends` in the
  // copied tsconfig — but that rewrite calls `ts.parseConfigFileTextToJson`, which TypeScript 7
  // no longer exposes, and without it Vite cannot resolve `../../tsconfig.base.json` from the
  // sandbox and every transform fails. Running in place skips the sandbox entirely; Stryker
  // backs the workspace up under `tempDirName` and restores it when the run ends.
  inPlace: true,
  tempDirName: "reports/mutation/.stryker-tmp",

  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },

  // No `break`: a falling score is an ordna task, not a failed build ([TEST6]). `high` and `low`
  // colour the report alone.
  thresholds: { high: 80, low: 60, break: null },
};
