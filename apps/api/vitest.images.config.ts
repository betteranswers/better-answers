import { configDefaults, defineConfig } from "vitest/config";

import suites from "./vitest.config.ts";

/** The images, the compose scripts and the stop each start a container or a process, so the images job runs them and `check` does not. */
export default defineConfig({
  ...suites,
  test: {
    ...suites.test,
    include: ["tests/images/**/*.test.ts"],
    exclude: configDefaults.exclude,
  },
});
