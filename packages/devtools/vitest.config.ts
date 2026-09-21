import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    // Every test here shells a real tool binary over a temporary tree; vitest's default
    // fails most of them.
    testTimeout: 60_000,
  },
});
