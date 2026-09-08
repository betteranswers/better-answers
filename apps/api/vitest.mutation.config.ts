import { mutationSuite } from "@better-answers/devtools/mutation-suite";

import base from "./vitest.config.ts";

/**
 * The suite as the mutation run sees it (`stryker.config.mjs`): the workspace's own config,
 * less the test files that reach `src` by no import — the image probes, the readers of the
 * repository's own files, the tool runs over throwaway trees — for the reason recorded in
 * `@better-answers/devtools/mutation-suite`. `check` keeps running every file.
 */
export default mutationSuite(base, import.meta.dirname, "tests", "@better-answers/api");
