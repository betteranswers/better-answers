import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The import-direction test shells out to oxlint over a temporary tree.
    testTimeout: 60_000,
  },
});
