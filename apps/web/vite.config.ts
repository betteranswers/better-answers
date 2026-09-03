import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * The single-page app is built to static files and served by the app tier on the `app.`
 * hostname (ADR 0006, amended 2026-09-02); it talks to `apps/api` over tRPC only and
 * imports nothing from it at runtime.
 *
 * Tailwind is a Vite plugin rather than a PostCSS step: v4 has no configuration file, and
 * its theme is the design system's tokens read through the bridge (ADR 0033).
 *
 * `@/` mirrors the tsconfig path: the layering overrides in `.oxlintrc.json` read a zone
 * out of the specifier, so a cross-directory import has to be written with it.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", sourcemap: true },
});
