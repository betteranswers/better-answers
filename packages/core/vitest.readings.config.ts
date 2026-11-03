import { defineConfig } from "vitest/config";

import suites from "./vitest.config.ts";

/** The owner's readings call a real model with a key, so `check` never selects them. */
export default defineConfig({
  ...suites,
  test: {
    ...suites.test,
    include: ["test/readings/*.reading.ts"],
    testTimeout: 3_600_000,
    maxWorkers: 1,
    // A shared worker hands later readings a warm JIT and cache, so each reading keeps its own.
    isolate: true,
  },
});
