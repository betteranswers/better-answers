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
    // A runaway guard, not a budget: it decides how long a wedged cluster hangs before Vitest
    // calls it. The template copy it governs is milliseconds; nothing healthy approaches this.
    hookTimeout: 120_000,
    // The Docker VM's CPU count, for the reason `packages/core/vitest.config.ts` records
    // beside the readings it was chosen from: the forks pool scales to the host's 14 cores
    // while every container a run starts lives inside a VM of 6. The readings are not
    // repeated here, because they were taken against that package's check and a measurement
    // copied into a second file is a second claim nobody re-takes when the first moves.
    maxWorkers: 6,
  },
});
