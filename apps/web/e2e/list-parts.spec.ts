import { fileURLToPath } from "node:url";

import type { APIRequestContext, Page } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { build } from "vite";

import { expect, test } from "./browser.ts";
import { tabUntilFocused } from "./harness.ts";

const ENTRY = "virtual:list-parts";

/** The build hands a library's entry over as a path under its root, so the plugin claims either. */
const RESOLVED_ENTRY = "\0list-parts";

const HARNESS = fileURLToPath(new URL("../test/members-list.tsx", import.meta.url));

/** No screen draws every shared part yet, so the unit suite's Members list is drawn on its own. */
const ENTRY_SOURCE = [
  'import { createElement } from "react";',
  'import { createRoot } from "react-dom/client";',
  `import { MembersList } from ${JSON.stringify(HARNESS)};`,
  'createRoot(document.getElementById("root")).render(createElement(MembersList, { pageSize: 2 }));',
].join("\n");

type Built = Awaited<ReturnType<typeof build>>;

const entryCodeOf = (built: Built): string => {
  for (const output of Array.isArray(built) ? built : [built]) {
    if (!("output" in output)) continue;
    const entry = output.output.find((chunk) => chunk.type === "chunk" && chunk.isEntry);
    if (entry?.type === "chunk") return entry.code;
  }
  throw new Error("the list parts built no entry chunk");
};

/** One script the page runs, built the way the app's own build compiles its source. */
const bundledParts = async (): Promise<string> =>
  entryCodeOf(
    await build({
      configFile: false,
      logLevel: "silent",
      mode: "production",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      plugins: [
        react(),
        {
          name: "list-parts",
          resolveId: (id) => (id.endsWith(ENTRY) ? RESOLVED_ENTRY : undefined),
          load: (id) => (id === RESOLVED_ENTRY ? ENTRY_SOURCE : undefined),
        },
      ],
      resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
      build: {
        write: false,
        minify: false,
        lib: { entry: ENTRY, formats: ["iife"], name: "listParts" },
      },
    }),
  );

let parts: string | undefined;

test.beforeAll(async () => {
  parts = await bundledParts();
});

/** The served build's own stylesheets, so the parts are measured as a screen draws them. */
const servedStylesheets = async (request: APIRequestContext): Promise<string> => {
  const served = await (await request.get("/")).text();
  const links = served.match(/<link[^>]*rel="stylesheet"[^>]*>/g) ?? [];
  expect(links, "the served build names no stylesheet").not.toHaveLength(0);
  return links.join("");
};

/** In the shell's own pane, on the product's origin, so the accessibility gate audits the parts. */
const drawn = async (page: Page, request: APIRequestContext) => {
  const head = await servedStylesheets(request);
  await page.goto("/health");
  await page.setContent(
    `<!doctype html><html lang="en-GB"><head><title>Members</title>${head}</head><body>` +
      '<main class="px-4 py-6"><div data-screen-content class="max-w-page"><div id="root"></div>' +
      "</div></main></body></html>",
  );
  await page.addScriptTag({ content: parts ?? "" });
  await expect(page.getByRole("table")).toBeVisible();
};

const bar = (page: Page) => page.getByRole("toolbar", { name: "Selected members" });

const tickOf = (page: Page, name: string) => page.getByRole("checkbox", { name: `Select ${name}` });

test.describe("the shared list parts, drawn together", () => {
  test("keep every part but the table inside 320 pixels", async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await drawn(page, request);
    await tickOf(page, "Cy Twombly").click();
    await tickOf(page, "Ada Lovelace").click();
    await expect(bar(page).getByRole("status")).toHaveText("2 members selected.");
    await expect(page.getByRole("navigation", { name: "Pages of members" })).toBeVisible();

    const room = await page.evaluate(() => {
      const edge = document.documentElement.clientWidth;
      const table = document.querySelector('[data-slot="table-container"]');
      const outside = [...document.querySelectorAll("main *")].filter(
        (node) => table === null || !table.contains(node),
      );
      return {
        scrolls: document.documentElement.scrollWidth,
        holds: edge,
        pastTheEdge: outside
          .filter((node) => node.getBoundingClientRect().right > edge)
          .map((node) => node.outerHTML.slice(0, 120)),
        tableScrolls: table?.scrollWidth ?? 0,
        tableHolds: table?.clientWidth ?? 0,
      };
    });
    expect(room.scrolls, "the page scrolls sideways").toBeLessThanOrEqual(room.holds);
    expect(room.pastTheEdge, "a part outside the table reaches past the edge").toEqual([]);
    // Six columns cannot wrap into 320 pixels; the table scrolls in its own box, and this says how far.
    test.info().annotations.push({
      type: "table at 320 pixels",
      description: `${String(room.tableScrolls)} px of columns in ${String(room.tableHolds)} px`,
    });
  });

  test("tick, menu and clear work by keyboard alone", async ({ page, request }) => {
    await drawn(page, request);

    await tabUntilFocused(page, tickOf(page, "Cy Twombly"));
    await page.keyboard.press("Space");
    await expect(bar(page).getByRole("status")).toHaveText("1 member selected.");

    const trigger = page.getByRole("button", { name: "Acts for Cy Twombly" });
    await tabUntilFocused(page, trigger);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Open" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await expect(page.getByRole("table")).toMatchAriaSnapshot(`
      - table "Members of this workspace.":
        - caption: Members of this workspace.
        - rowgroup:
          - row:
            - columnheader "Select every member on this page":
              - checkbox "Select every member on this page" [checked=mixed]
            - columnheader "Person":
              - button "Person"
            - columnheader "Role":
              - button "Role"
            - columnheader "Groups"
            - columnheader "Joined"
            - columnheader "Acts"
        - rowgroup:
          - row /Cy Twombly/:
            - cell "Select Cy Twombly":
              - checkbox "Select Cy Twombly" [checked]
            - cell /Cy Twombly/:
              - link "Cy Twombly"
            - cell "Viewer"
            - cell "Finance"
            - cell "3 March 2026"
            - cell "Acts for Cy Twombly":
              - button "Acts for Cy Twombly"
    `);

    await page.keyboard.press("x");
    await expect(bar(page)).toBeHidden();
  });
});
