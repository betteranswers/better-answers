import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],

    globalSetup: ["@better-answers/schema/testing/warm-postgres"],

    testTimeout: 60_000,

    hookTimeout: 120_000,

    maxWorkers: 6,
  },
});
