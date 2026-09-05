import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Every test here shells out to a real tool binary over a temporary tree.
    testTimeout: 60_000,
  },
});
