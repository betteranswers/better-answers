import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // `.ts` as well as `.tsx`: the lint-rule suite is plain TypeScript running oxlint over a
    // throwaway tree, and it has no component to render.
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "jsdom",
  },
});
