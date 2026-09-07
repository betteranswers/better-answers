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
    hookTimeout: 300_000,
  },
});
