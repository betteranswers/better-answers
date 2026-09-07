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

  // A mutant here can leave a Testcontainers Postgres waiting on a query that will never answer;
  // the timeout has to clear the container start the suite's `beforeAll` pays for.
  timeoutMS: 300_000,

  // Each test runner process owns a Postgres container. Two is what a 2-vCPU hosted runner can
  // hold without the containers starving each other (`runs-on` in the workflow).
  concurrency: 2,
};
