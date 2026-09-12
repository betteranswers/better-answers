import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // One container and one migrated template for the whole run, started before the first
    // file and stopped only when the Vitest instance closes. Named as the schema package's
    // export rather than a path into it, because a workspace outside that package has no
    // business knowing where inside it the entry lives.
    globalSetup: ["@better-answers/schema/testing/warm-postgres"],
    // A cold run pulls the Postgres image before the first test.
    testTimeout: 60_000,
    // A runaway guard, not a budget: it decides how long a wedged cluster hangs before Vitest
    // calls it. The template copy it governs is milliseconds; nothing healthy approaches this.
    // `image.test.ts` sets its own, because a docker build is not this call.
    hookTimeout: 120_000,
    // Capped at the Docker VM's CPU count, for the reason and from the readings that
    // `packages/core/vitest.config.ts` carries. This workspace is capped even though the
    // readings were not taken against it, because what it contributes to is the total: the
    // root check runs it alongside core and schema rather than alone, and a cap on two of
    // the three would leave the third free to over-subscribe the same six CPUs.
    maxWorkers: 6,
  },
});
