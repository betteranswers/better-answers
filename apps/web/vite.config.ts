import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { FIRST_PAINT } from "./src/shared/theme-switch.ts";
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

/** In the order `styles.css` imports them, so a later rule wins as it does in the browser. */
const TOKEN_FILES = ["tokens/colors.css", "tokens/semantic.css"];

const COMMENT = /\/\*[\s\S]*?\*\//g;

const RULE = /([^{};]+)\{([^{}]*)\}/g;

const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+)/g;

const REFERENCE = /^var\(\s*(--[\w-]+)\s*\)$/;

/** A rule inside an at-rule is read as if it stood alone. */
const tokensUnder = (selectors: readonly string[]): ReadonlyMap<string, string> => {
  const css = TOKEN_FILES.map(designSystem).join("\n").replaceAll(COMMENT, "");
  const tokens = new Map<string, string>();
  for (const [, selector = "", body = ""] of css.matchAll(RULE)) {
    const named = selector.split(",").map((one) => one.replaceAll(/\s+/g, " ").trim());
    if (!named.some((one) => selectors.includes(one))) continue;
    for (const [, name = "", value = ""] of body.matchAll(DECLARATION)) {
      tokens.set(name, value.trim());
    }
  }
  return tokens;
};

const resolvedIn = (tokens: ReadonlyMap<string, string>, name: string, hops = 0): string => {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`the design system sets no ${name}`);
  const next = REFERENCE.exec(value)?.[1];
  if (next === undefined) return value;
  if (hops > tokens.size) throw new Error(`the design system's ${name} refers back to itself`);
  return resolvedIn(tokens, next, hops + 1);
};

const textColourOf = (selectors: readonly string[]): string =>
  resolvedIn(tokensUnder(selectors), "--text-primary");

/** A tab draws the logo's `currentColor` black, which a dark tab strip hides. */
const tabIcon = (): string => {
  const light = textColourOf([":root"]);
  const dark = textColourOf([":root", '[data-theme="dark"]']);
  const style = `<style>svg{color:${light}}@media (prefers-color-scheme:dark){svg{color:${dark}}}</style>`;
  const logo = designSystem("assets/logo.svg");
  const icon = logo.replace(/<svg\b[^>]*>/, (opened) => `${opened}${style}`);
  if (icon === logo) throw new Error("the design system's logo has no <svg> to style");
  return `data:image/svg+xml,${encodeURIComponent(icon)}`;
};

const theHead = (): Plugin => ({
  name: "the-head",
  transformIndexHtml: () => [
    { tag: "script", children: FIRST_PAINT, injectTo: "head-prepend" },
    { tag: "title", children: PRODUCT_NAME, injectTo: "head" },
    {
      tag: "link",
      attrs: { rel: "icon", type: "image/svg+xml", href: tabIcon() },
      injectTo: "head",
    },
  ],
});

export default defineConfig({
  plugins: [react(), tailwindcss(), theHead()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist",
    sourcemap: true,
    rolldownOptions: { output: { codeSplitting: { groups: LIBRARY_GROUPS } } },
  },
});
