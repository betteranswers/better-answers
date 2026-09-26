import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    setupFiles: ["@better-answers/schema/testing/test-title-setup"],

    testTimeout: 60_000,
  },
});
