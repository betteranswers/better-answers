import { defineConfig } from "vitest/config";

import { pathWithAppleGit } from "@better-answers/schema/testing/apple-git";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    env: { PATH: pathWithAppleGit() },

    setupFiles: ["@better-answers/schema/testing/test-title-setup"],

    testTimeout: 60_000,
  },
});
