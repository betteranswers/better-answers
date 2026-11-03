import { defineConfig } from "vitest/config";

import suites from "./vitest.config.ts";

export default defineConfig({
  ...suites,
  test: {
    ...suites.test,
    include: ["test/budgets/*.budget.ts"],
    maxWorkers: 1,
    // Each budget was set against a file run alone; a shared worker would hand later files a warm JIT.
    isolate: true,
  },
});
