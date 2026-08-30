import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The single-page app is built to static files and served by the app tier
 * (ADR 0006); it talks to `app/` over tRPC only and never imports from it.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: true },
});
