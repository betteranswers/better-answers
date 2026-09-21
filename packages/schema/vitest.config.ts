import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    // An absolute path: Vitest imports a globalSetup entry as it is written rather than
    // resolving it against this file.
    globalSetup: [fileURLToPath(new URL("./test/warm-postgres.ts", import.meta.url))],

    testTimeout: 60_000,

    hookTimeout: 120_000,

    maxWorkers: 6,
  },
});
