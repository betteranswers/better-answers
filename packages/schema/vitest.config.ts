import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One container and one migrated template for the whole run, started before the first
    // file and stopped only when the Vitest instance closes. An absolute path because
    // Vitest imports a globalSetup entry as it is written rather than resolving it against
    // this file; a workspace outside this package names the package's export instead.
    globalSetup: [fileURLToPath(new URL("./test/warm-postgres.ts", import.meta.url))],
    // A cold run pulls the Postgres image before the first test.
    testTimeout: 60_000,
  },
});
