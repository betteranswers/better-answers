import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { PRODUCT_NAME } from "./src/shared/words.ts";

/**
 * Under pnpm's store the last `node_modules/<name>/` segment names the library, so each test ends
 * at that boundary.
 */
const LIBRARY_GROUPS = [
  { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
  { name: "tanstack", test: /node_modules[\\/]@tanstack[\\/]/, priority: 30 },
  { name: "trpc", test: /node_modules[\\/]@trpc[\\/]/, priority: 30 },
  { name: "vendor", test: /node_modules[\\/]/, priority: 10 },
];

const designSystem = (file: string): string =>
  readFileSync(
    createRequire(import.meta.url).resolve(`@better-answers/design-system/${file}`),
    "utf8",
  );

const tokenIn = (css: string, selector: string, name: string): string => {
  const rule = css.split(`${selector} {`)[1]?.split("}")[0] ?? "";
  const value = new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`).exec(rule)?.[1]?.trim();
  if (value === undefined) throw new Error(`the design system's ${selector} sets no ${name}`);
  return value;
};

const textColourOf = (theme: string): string => {
  const value = tokenIn(designSystem("tokens/semantic.css"), theme, "--text-primary");
  const step = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return step === undefined ? value : tokenIn(designSystem("tokens/colors.css"), ":root", step);
};

/** A tab draws the logo's `currentColor` black, which a dark tab strip hides. */
const tabIcon = (): string => {
  const light = textColourOf(":root");
  const dark = textColourOf('[data-theme="dark"]');
  const style = `<style>svg{color:${light}}@media (prefers-color-scheme:dark){svg{color:${dark}}}</style>`;
  const logo = designSystem("assets/logo.svg");
  const icon = logo.replace(/<svg\b[^>]*>/, (opened) => `${opened}${style}`);
  if (icon === logo) throw new Error("the design system's logo has no <svg> to style");
  return `data:image/svg+xml,${encodeURIComponent(icon)}`;
};

const theTab = (): Plugin => ({
  name: "the-tab",
  transformIndexHtml: () => [
    { tag: "title", children: PRODUCT_NAME, injectTo: "head" },
    {
      tag: "link",
      attrs: { rel: "icon", type: "image/svg+xml", href: tabIcon() },
      injectTo: "head",
    },
  ],
});

export default defineConfig({
  plugins: [react(), tailwindcss(), theTab()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist",
    sourcemap: true,
    rolldownOptions: { output: { codeSplitting: { groups: LIBRARY_GROUPS } } },
  },
});
