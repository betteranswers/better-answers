import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],

    // A file that wants the object store names `objectStoreForSuite` in its own source, or the
    // run it is selected in starts no Garage for it.
    globalSetup: [
      "@better-answers/schema/testing/warm-postgres",
      "@better-answers/core/testing/warm-objects",
    ],

    testTimeout: 60_000,

    hookTimeout: 120_000,

    maxWorkers: 6,
  },
});
