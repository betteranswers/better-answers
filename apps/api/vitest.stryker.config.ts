import { mergeConfig } from "vitest/config";

import base from "./vitest.config.ts";

export default mergeConfig(base, {
  test: {
    // A hosted runner adds `github-actions`, whose job summary would be appended once per mutant,
    // and whose annotations would name only killed mutants.
    reporters: ["default"],

    // Stryker runs every file in one worker, and a static mutant is live only in a module evaluated
    // after Stryker activates it.
    isolate: true,
  },
});
