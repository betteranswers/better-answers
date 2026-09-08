/**
 * Mutation testing for this tier, run weekly by .github/workflows/mutation.yml.
 *
 * @type {import("@stryker-mutator/api/core").PartialStrykerOptions}
 */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.config.ts" },

  // `main.ts` and `migrate.ts` are the tier's entry points, not its behaviour: they read the
  // bootstrap and hand off, and nothing crosses a seam a test could reach.
  mutate: ["src/**/*.ts", "!src/main.ts", "!src/migrate.ts"],
  coverageAnalysis: "perTest",

  // A mutant no test covers per test — a module-level declaration, run once when the file
  // loads — is "static" to the planner. With this off the planner runs the whole suite for
  // it; when that run completes no test, the report says `Survived` with `testsCompleted: 0`,
  // a mutant nothing tested counted as one everything failed to kill (the rows T-088 found
  // were module-level `declareActs` strings). With it on, a static mutant with
  // no per-test coverage is `Ignored` under Stryker's own reason string and leaves the score,
  // while a hybrid mutant — static plus per-test coverage — still runs against its covering
  // tests. Read from @stryker-mutator/core 10.0.0, `dist/src/mutants/mutant-test-planner.js`
  // lines 71–99 (`planMutant`: the `isStatic` / `ignoreStatic` decision), on 08/09/2026.
  // The cost is the exclusion itself: a module-scope constant only an import exercises is
  // no longer run at all, so the schedule's summary shows each leg's Ignored count beside
  // its score (T-090) and a row that matters is probed by hand, `scripts/mutant-probe.mjs`.
  ignoreStatic: true,

  // Stryker's sandbox copies the workspace to a temp directory and rewrites `extends` in the
  // copied tsconfig — but that rewrite calls `ts.parseConfigFileTextToJson`, which TypeScript 7
  // no longer exposes, and without it Vite cannot resolve `../../tsconfig.base.json` from the
  // sandbox and every transform fails. Running in place skips the sandbox entirely; Stryker
  // backs the tier up under `tempDirName` and restores it when the run ends.
  inPlace: true,
  tempDirName: "reports/mutation/.stryker-tmp",

  // Incremental mode: each mutant's result is stored and reused next week for every file
  // whose source and covering tests are unchanged. Without it this leg pays a Postgres
  // container start for every mutant in the tier, changed or not, which is the cost that
  // bounds it. The workflow restores and saves the file with actions/cache, and nothing
  // else carries it — `reports/` is git-ignored.
  incremental: true,
  // Under `reports/` so the restore lands in a git-ignored directory and leaves the working
  // tree clean, and beside the run's other output rather than inside `tempDirName`: the
  // temp directory and its backup are deleted after a successful run, so an incremental
  // file kept there would be thrown away by the very run that wrote it.
  incrementalFile: "reports/mutation/stryker-incremental.json",

  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },

  // No `break`: a falling score is an ordna task, not a failed build. `high` and `low`
  // colour the report alone.
  thresholds: { high: 80, low: 60, break: null },

  // Slack over the covering tests' measured time and Stryker's own measured overhead, so it
  // need only clear a file's re-import and its template copy. A hung mutant is billed it.
  timeoutMS: 30_000,

  // Never raise: restarting a worker discards the Postgres container its `globalSetup` started,
  // and every mutant after it pays a container start again.
  maxTestRunnerReuse: 0,

  // Each test runner process owns a Postgres container. Two is what a 2-vCPU hosted runner can
  // hold without the containers starving each other (`runs-on` in the workflow).
  concurrency: 2,
};
