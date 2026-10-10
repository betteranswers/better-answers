import { fileURLToPath } from "node:url";

import { expect, type APIRequestContext, type Page } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { build } from "vite";

type Built = Awaited<ReturnType<typeof build>>;

const entryCodeOf = (built: Built, name: string): string => {
  for (const output of Array.isArray(built) ? built : [built]) {
    if (!("output" in output)) continue;
    const entry = output.output.find((chunk) => chunk.type === "chunk" && chunk.isEntry);
    if (entry?.type === "chunk") return entry.code;
  }
  throw new Error(`the ${name} built no entry chunk`);
};

/**
 * A unit-suite harness rendered into `#root`, built the way the app's own build compiles its
 * source, because no page draws every shared part yet.
 */
export const bundledHarness = async (harness: {
  readonly name: string;
  readonly file: URL;
  readonly component: string;
  readonly props?: Record<string, unknown>;
}): Promise<string> => {
  const entry = `virtual:${harness.name}`;
  // The build hands a library's entry over as a path under its root, so the plugin claims either.
  const resolved = `\0${harness.name}`;
  const source = [
    'import { createElement } from "react";',
    'import { createRoot } from "react-dom/client";',
    `import { ${harness.component} } from ${JSON.stringify(fileURLToPath(harness.file))};`,
    `createRoot(document.getElementById("root")).render(createElement(${harness.component}, ${JSON.stringify(harness.props ?? {})}));`,
  ].join("\n");
  return entryCodeOf(
    await build({
      configFile: false,
      logLevel: "silent",
      mode: "production",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      plugins: [
        react(),
        {
          name: harness.name,
          resolveId: (id) => (id.endsWith(entry) ? resolved : undefined),
          load: (id) => (id === resolved ? source : undefined),
        },
      ],
      resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ["iife"], name: harness.component },
      },
    }),
    harness.name,
  );
};

/** The served build's own stylesheets, so the parts are measured as a page draws them. */
const servedStylesheets = async (request: APIRequestContext): Promise<string> => {
  const served = await (await request.get("/")).text();
  const links = served.match(/<link[^>]*rel="stylesheet"[^>]*>/g) ?? [];
  expect(links, "the served build names no stylesheet").not.toHaveLength(0);
  return links.join("");
};

/** On the product's origin, so the gate audits it. A class only the harness writes is not served. */
export const harnessDrawn = async (
  page: Page,
  request: APIRequestContext,
  drawn: { readonly title: string; readonly script: string },
): Promise<void> => {
  const head = await servedStylesheets(request);
  await page.goto("/health");
  await page.setContent(
    `<!doctype html><html lang="en-GB"><head><title>${drawn.title}</title>${head}</head><body>` +
      '<main class="px-4 py-6"><div data-page-content class="max-w-page"><div id="root"></div>' +
      "</div></main></body></html>",
  );
  await page.addScriptTag({ content: drawn.script });
};
