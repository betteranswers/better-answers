import { mutationSuite } from "@better-answers/devtools/mutation-suite";

import base from "./vitest.config.ts";

/**
 * The suite as the mutation run sees it (`stryker.config.mjs`): the package's own config,
 * less the test files that reach `src` by no import — here the import-direction test, which
 * runs oxlint over a throwaway tree — for the reason recorded in
 * `@better-answers/devtools/mutation-suite`. `check` keeps running every file.
 */
export default mutationSuite(base, import.meta.dirname, "test", "@better-answers/core");
