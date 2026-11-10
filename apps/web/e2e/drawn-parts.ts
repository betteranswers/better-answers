import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type APIRequestContext, type Page } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { build } from "vite";

import { rootsOf } from "@better-answers/schema/testing/roots";

const { workspaceRoot } = rootsOf(import.meta.url);

type Built = Awaited<ReturnType<typeof build>>;

const entryCodeOf = (built: Built, name: string): string => {
  for (const output of Array.isArray(built) ? built : [built]) {
    if (!("output" in output)) continue;
    const entry = output.output.find((chunk) => chunk.type === "chunk" && chunk.isEntry);
    if (entry?.type === "chunk") return entry.code;
  }
  throw new Error(`The Vite build of ${name} produced no entry chunk`);
};

export const bundledHarness = async (harness: {
  readonly name: string;
  readonly file: URL;
  readonly component: string;
  readonly props?: Record<string, unknown>;
}): Promise<string> => {
  const entry = `virtual:${harness.name}`;
  // Vite may pass the library entry to resolveId as a path under the build root, so the plugin matches by suffix.
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
      resolve: { alias: { "@": path.join(workspaceRoot, "src") } },
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ["iife"], name: harness.component },
      },
    }),
    harness.name,
  );
};

const servedStylesheetLinks = async (request: APIRequestContext): Promise<string> => {
  const served = await (await request.get("/")).text();
  const links = served.match(/<link[^>]*rel="stylesheet"[^>]*>/g) ?? [];
  expect(links, "the served page links no stylesheet").not.toHaveLength(0);
  return links.join("");
};

export const harnessDrawn = async (
  page: Page,
  request: APIRequestContext,
  content: { readonly title: string; readonly script: string },
): Promise<void> => {
  const head = await servedStylesheetLinks(request);
  await page.goto("/health");
  await page.setContent(
    `<!doctype html><html lang="en-GB"><head><title>${content.title}</title>${head}</head><body>` +
      '<main class="px-4 py-6"><div data-page-content class="max-w-page"><div id="root"></div>' +
      "</div></main></body></html>",
  );
  await page.addScriptTag({ content: content.script });
};
