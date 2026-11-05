/** Vitest's own default, in milliseconds. */
const VITEST_DEFAULT = 300;

/** On GitHub Actions, database tests often take over 300 ms, so only a test over five seconds counts as slow. */
const ACTIONS_THRESHOLD = 5_000;

export const slowTestThreshold = (env: NodeJS.ProcessEnv = process.env): number =>
  env["GITHUB_ACTIONS"] ? ACTIONS_THRESHOLD : VITEST_DEFAULT;
