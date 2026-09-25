import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";

// Mutation-testing config: the node project ONLY, flattened (no `projects`
// array — Stryker's vitest runner drives a single project). The workers-pool
// project is deliberately absent: mutation testing spawns hundreds of runs,
// and each workers run boots a full workerd via Miniflare.
const cloudflareWorkersShim = fileURLToPath(
  new URL("./src/test-utils/cloudflare-workers-shim.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: { "cloudflare:workers": cloudflareWorkersShim },
  },
  test: {
    globals: true,
    exclude: [
      ...configDefaults.exclude,
      "src/**/*.workers.test.ts",
      "e2e/**/*.spec.ts",
      ".claude/worktrees/**",
      ".worktrees/**",
      ".stryker-tmp/**",
    ],
  },
});
