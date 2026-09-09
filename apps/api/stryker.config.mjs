/**
 * Mutation testing for this tier, run nightly by .github/workflows/mutation.yml.
 *
 * @type {import("@stryker-mutator/api/core").PartialStrykerOptions}
 */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  // A mutant that throws while its module loads — an emptied MCP entry name here, an
  // emptied act family in packages/core — makes every test file importing it fail before
  // one test runs, and @stryker-mutator/vitest-runner 10.0.0 reads a file with no test tasks
  // as nothing ran (`dist/src/vitest-test-runner.js` lines 171–179, read 09/09/2026): the
  // mutant is reported `Survived` with `testsCompleted: 0`, though every test would have
  // failed. Nine such rows here and thirty in packages/core in run 34168928594, all of that
  // shape (T-107). `patches/@stryker-mutator__vitest-runner@10.0.0.patch` — applied by pnpm
  // through `pnpm-workspace.yaml` — counts a test file that failed to load as one failed
  // test named for the file, so the mutant is killed with the error it caused and a dry run
  // with such a file refuses to start. Per-mutant cost is unchanged: the same tests run.
  // `vitest.related` stays on (the default): T-097 read it as the cause, and it is not —
  // vitest relates fourteen test files to `mcp/entries/index.ts` (`vitest related`, run
  // 09/09/2026) — and off, a static mutant pays every test file's setup (both legs past
  // the two-hour timeout in run 34286280490).
  vitest: { configFile: "vitest.config.ts" },

  // `main.ts` and `migrate.ts` are the tier's entry points, not its behaviour: they read the
  // bootstrap and hand off, and nothing crosses a seam a test could reach.
  mutate: ["src/**/*.ts", "!src/main.ts", "!src/migrate.ts"],
  coverageAnalysis: "perTest",

  // `ignoreStatic` stays off. A mutant no test covers per test — a module-level declaration,
  // run once when the file loads — is "static" to the planner, and with the option off the
  // planner runs the whole suite for it (@stryker-mutator/core 10.0.0,
  // `dist/src/mutants/mutant-test-planner.js` lines 88–95, read 08/09/2026), which is what
  // kills it: the suite killed 304 of this tier's 324 static mutants in run 34168928594. With
  // the option on, a static mutant with no per-test coverage is `Ignored` and never run, and
  // one with per-test coverage runs only its covering tests (lines 71–80) — so a mutant a
  // dynamic import made hybrid ran nothing at all. Run 34263846345 measured it: those 304
  // kills gone here, and 192 phantom survivors in packages/core where the run before had 30. The rows that motivated
  // the option — `Survived` with `testsCompleted: 0` — are the runner reading a test file
  // that failed to load as no tests run (the patch above), not a mutant to skip.

  // Stryker's sandbox copies the workspace to a temp directory and rewrites `extends` in the
  // copied tsconfig — but that rewrite calls `ts.parseConfigFileTextToJson`, which TypeScript 7
  // no longer exposes, and without it Vite cannot resolve `../../tsconfig.base.json` from the
  // sandbox and every transform fails. Running in place skips the sandbox entirely; Stryker
  // backs the tier up under `tempDirName` and restores it when the run ends.
  inPlace: true,
  tempDirName: "reports/mutation/.stryker-tmp",

  // Incremental mode: each mutant's result is stored and reused the next night for every file
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

  // Each test runner process owns a Postgres container, so this is also the container count.
  // Four because the hosted `ubuntu-latest` runner a public repository gets has four vCPUs
  // and 16 GB (https://docs.github.com/en/actions/reference/runners/github-hosted-runners,
  // read 09/09/2026; a private repository's has two, which is where two came from). At two,
  // a forced full run of this leg reached 84% of its mutants at the two-hour timeout (run
  // 34292833221): a static mutant here boots the app for every related test file, and the
  // false kills that once cut those runs short (`tests/health.test.ts`) are gone.
  concurrency: 4,
};
