/**
 * Mutation testing for this tier ([TEST6]), run weekly by .github/workflows/mutation.yml.
 *
 * @type {import("@stryker-mutator/api/core").PartialStrykerOptions}
 */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.config.ts" },

  // `main.ts` and `migrate.ts` are the tier's entry points, not its behaviour: they read the
  // bootstrap and hand off, and nothing crosses a seam a test could reach ([APP1], [TEST1]).
  mutate: ["src/**/*.ts", "!src/main.ts", "!src/migrate.ts"],
  coverageAnalysis: "perTest",

  // Stryker's sandbox copies the workspace to a temp directory and rewrites `extends` in the
  // copied tsconfig — but that rewrite calls `ts.parseConfigFileTextToJson`, which TypeScript 7
  // no longer exposes, and without it Vite cannot resolve `../../tsconfig.base.json` from the
  // sandbox and every transform fails. Running in place skips the sandbox entirely; Stryker
  // backs the tier up under `tempDirName` and restores it when the run ends.
  inPlace: true,
  tempDirName: "reports/mutation/.stryker-tmp",

  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },

  // No `break`: a falling score is an ordna task, not a failed build ([TEST6]). `high` and `low`
  // colour the report alone.
  thresholds: { high: 80, low: 60, break: null },

  // A mutant here can leave a Testcontainers Postgres waiting on a query that will never answer;
  // the timeout has to clear the container start the suite's `beforeAll` pays for ([TEST2]).
  timeoutMS: 300_000,

  // Each test runner process owns a Postgres container. Two is what a 2-vCPU hosted runner can
  // hold without the containers starving each other (`runs-on` in the workflow).
  concurrency: 2,
};
