import { defineConfig } from "vitest/config";

import suites from "./vitest.config.ts";

export default defineConfig({
  ...suites,
  test: {
    ...suites.test,
    include: ["test/budgets/*.budget.ts"],
    maxWorkers: 1,
  },
});
