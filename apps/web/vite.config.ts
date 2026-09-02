import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The single-page app is built to static files and served by the app tier on the `app.`
 * hostname (ADR 0006, amended 2026-09-02); it talks to `apps/api` over tRPC only and
 * imports nothing from it at runtime.
 *
 * Tailwind is a Vite plugin rather than a PostCSS step: v4 has no configuration file, and
 * its theme is the design system's tokens read through the bridge (ADR 0033).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: true },
});
