import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One container and one migrated template for the whole run, started before the first
    // file and stopped only when the Vitest instance closes. The schema package's own export
    // rather than a copy of it, so the setup this package registers is the setup every other
    // workspace registers.
    globalSetup: ["@better-answers/schema/testing/warm-postgres"],
    // The import-direction test shells out to oxlint over a temporary tree.
    testTimeout: 60_000,
    // A runaway guard, not a budget for the copy: the room is for the opener's cold fallback,
    // which pays a container start wherever nothing provided a warm one.
    hookTimeout: 120_000,
  },
});
