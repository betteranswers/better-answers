import { configDefaults, defineConfig } from "vitest/config";

import suites from "./vitest.config.ts";

export default defineConfig({
  ...suites,
  test: {
    ...suites.test,
    include: ["tests/images/**/*.test.ts"],
    exclude: configDefaults.exclude,
  },
});
