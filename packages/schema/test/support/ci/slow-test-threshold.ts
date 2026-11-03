/** Vitest's own default, in milliseconds. */
const VITEST_DEFAULT = 300;

/** In Actions the default reporter's slow-test listing repeats each test over the threshold under its describe parents. */
export const slowTestThreshold = (env: NodeJS.ProcessEnv = process.env): number =>
  env["GITHUB_ACTIONS"] ? Infinity : VITEST_DEFAULT;
