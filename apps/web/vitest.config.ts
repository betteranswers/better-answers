import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { pathWithAppleGit } from "@better-answers/schema/testing/apple-git";
import { slowTestThreshold } from "@better-answers/schema/testing/slow-test-threshold";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@test": fileURLToPath(new URL("./test/support", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    slowTestThreshold: slowTestThreshold(),
    environment: "jsdom",
    env: { PATH: pathWithAppleGit() },
    setupFiles: [
      "./test/support/setup/fresh-file.ts",
      "@better-answers/schema/testing/test-title-setup",
      "./test/support/jsdom/scroll-to.ts",
    ],
    isolate: false,
  },
});
