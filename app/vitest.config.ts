import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A cold run pulls the Postgres image before the first test ([TEST2]).
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
