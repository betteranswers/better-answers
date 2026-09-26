import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { pathWithAppleGit } from "@better-answers/schema/testing/apple-git";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "jsdom",
    env: { PATH: pathWithAppleGit() },
    setupFiles: ["@better-answers/schema/testing/test-title-setup"],
  },
});
