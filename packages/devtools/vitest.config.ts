import { defineConfig } from "vitest/config";

import { pathWithAppleGit } from "@better-answers/schema/testing/apple-git";
import { slowTestThreshold } from "@better-answers/schema/testing/slow-test-threshold";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    env: { PATH: pathWithAppleGit() },

    setupFiles: ["@better-answers/schema/testing/test-title-setup"],

    testTimeout: 60_000,

    slowTestThreshold: slowTestThreshold(),
  },
});
