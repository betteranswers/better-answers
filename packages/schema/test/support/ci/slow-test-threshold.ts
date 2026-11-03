/** Vitest's own default, in milliseconds. */
const VITEST_DEFAULT = 300;

/** In Actions, DB-backed tests often pass 300 ms, so only a test over five seconds is listed as slow. */
const ACTIONS_THRESHOLD = 5_000;

export const slowTestThreshold = (env: NodeJS.ProcessEnv = process.env): number =>
  env["GITHUB_ACTIONS"] ? ACTIONS_THRESHOLD : VITEST_DEFAULT;
