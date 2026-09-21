import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    globalSetup: [fileURLToPath(new URL("./test/warm-postgres.ts", import.meta.url))],

    testTimeout: 60_000,

    hookTimeout: 120_000,

    maxWorkers: 6,
  },
});
