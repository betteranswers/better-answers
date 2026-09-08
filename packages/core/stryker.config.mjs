/**
 * Mutation testing for this package, run nightly by .github/workflows/mutation.yml.
 *
 * This is where the decisions live (ADR 0029), and its suite drives them through the
 * `exports` map over a real migrated Postgres — so a mutant that survives here is a
 * sentence about the tests rather than about the runner. The worked example the schedule
 * was added for is the Postgres door's COMMIT-tag check: a mutant that drops or inverts
 * the tag comparison, or empties the "COMMIT" literal, has to die in the transaction
 * suites, and if it lives the fault is this config, not the tests.
 *
 * @type {import("@stryker-mutator/api/core").PartialStrykerOptions}
 */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  // `related` off, for the reason recorded in full in apps/api/stryker.config.mjs (the
  // runner's `related` filter, `vitest-test-runner.js` lines 129–132 and 139–142). This is
  // the package where the lookup found nothing most: the declared-acts walk reaches every
  // slice through `await import(/* @vite-ignore */ file)` (`test/audit.test.ts`), which the
  // filter cannot see, so a module no other test imports statically ran no test — 30 rows
  // `Survived` with `testsCompleted: 0` in run 34168928594, 192 in run 34263846345. Cost per
  // mutant, job time over mutants tested: 1.3 s in run 34168928594 with the option on; the
  // run with it off is recorded in T-107's Progress. The suite is the one
  // `vitest.mutation.config.ts` shapes: every test file that reaches `src`.
  vitest: { configFile: "vitest.mutation.config.ts", related: false },

  // Everything under `src` is behaviour. Unlike a tier, this package has no process entry
  // point to leave out: nothing here starts a server or reads a bootstrap, which is what
  // makes it the library the transports call rather than one of them.
  mutate: ["src/**/*.ts"],
  coverageAnalysis: "perTest",

  // `ignoreStatic` stays off, for the reason recorded in full in apps/api/stryker.config.mjs.
  // This package is where the option did the most harm: every module-scope mutant here is
  // covered by exactly one test, the declared-acts walk, which reaches every slice through a
  // dynamic import vitest's `related` lookup cannot see — so with the option on, 192 mutants
  // ran no test and read as survivors, most of them kills the whole suite had made a run
  // earlier (run 34263846345 against 34168928594).

  // In place rather than in Stryker's sandbox, for the reason recorded in full in
  // apps/api/stryker.config.mjs: the sandbox rewrites `extends` in the copied tsconfig
  // through a TypeScript 7 API that no longer exists, and without it Vite cannot resolve
  // `../../tsconfig.base.json` from the copy. Stryker backs the package up under
  // `tempDirName` instead and restores it when the run ends.
  inPlace: true,
  tempDirName: "reports/mutation/.stryker-tmp",

  // Incremental mode: each mutant's result is stored and reused the next night for every file
  // whose source and covering tests are unchanged. The workflow restores and saves the
  // file with actions/cache, and nothing else carries it — `reports/` is git-ignored.
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

  // Each test runner process owns a Postgres container. Two is what a 2-vCPU hosted runner
  // can hold without the containers starving each other (`runs-on` in the workflow).
  concurrency: 2,
};
