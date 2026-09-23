/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
// @ts-nocheck

export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.config.ts" },

  mutate: ["src/**/*.ts"],
  coverageAnalysis: "perTest",

  // Stryker's sandbox cannot resolve the shared tsconfig it rewrites, so the run happens in
  // place over a backup.
  inPlace: true,
  tempDirName: "reports/mutation/.stryker-tmp",

  incremental: true,
  // Kept out of `tempDirName`, which a successful run deletes.
  incrementalFile: "reports/mutation/stryker-incremental.json",

  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },

  // No `break`: a falling score is a task, never a failed build.
  thresholds: { high: 80, low: 60, break: null },

  // Slack over the covering tests' measured time, so a mutant need only clear a re-import.
  timeoutMS: 30_000,

  // Never raise: restarting a worker discards the containers its `globalSetup` started, and
  // every mutant after it pays a container start again.
  maxTestRunnerReuse: 0,

  // Each test runner process owns its run's containers, and the hosted runner has four vCPUs.
  concurrency: 4,
};
