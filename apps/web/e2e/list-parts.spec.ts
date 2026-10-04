import { fileURLToPath } from "node:url";

import type { APIRequestContext, Locator, Page } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { build } from "vite";

import { expect, test } from "./browser.ts";
import { tabUntilFocused } from "./harness.ts";

const ENTRY = "virtual:list-parts";

/** The build hands a library's entry over as a path under its root, so the plugin claims either. */
const RESOLVED_ENTRY = "\0list-parts";

const HARNESS = fileURLToPath(new URL("../test/members-list.tsx", import.meta.url));

/** No page draws every shared part yet, so the unit suite's Members list is drawn on its own. */
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

/** The served build's own stylesheets, so the parts are measured as a page draws them. */
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
      '<main class="px-4 py-6"><div data-page-content class="max-w-page"><div id="root"></div>' +
      "</div></main></body></html>",
  );
  await page.addScriptTag({ content: parts ?? "" });
  await expect(page.getByRole("table")).toBeVisible();
};

const bar = (page: Page) => page.getByRole("toolbar", { name: "Selected members" });

const tickOf = (page: Page, name: string) => page.getByRole("checkbox", { name: `Select ${name}` });

/** The bar sits above the table, so a reader on a row's tick goes back to reach it. */
const backUntilFocused = async (page: Page, target: Locator) => {
  for (let pressed = 0; pressed < 10; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Shift+Tab");
  }
  await expect(target, "Shift+Tab never reached it").toBeFocused();
};

/** WCAG's minimum target, measured as the points around a box that a press on it reaches. */
const TARGET = 24;

/** The box as drawn, and each corner of a 24-pixel square on its centre that misses it. */
const targetOf = (tick: Locator) =>
  tick.evaluate((node, side) => {
    const box = node.getBoundingClientRect();
    const reach = side / 2 - 0.5;
    const corners: readonly (readonly [number, number])[] = [
      [-reach, -reach],
      [reach, -reach],
      [-reach, reach],
      [reach, reach],
    ];
    const missed = corners.filter(([across, down]) => {
      const hit = document.elementFromPoint(
        box.left + box.width / 2 + across,
        box.top + box.height / 2 + down,
      );
      return hit === null || !node.contains(hit);
    });
    return { drawn: [box.width, box.height], missed };
  }, TARGET);

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

  test("the bar takes one tab stop; Clear hands focus on", async ({ page, request }) => {
    await drawn(page, request);
    await tabUntilFocused(page, tickOf(page, "Cy Twombly"));
    await page.keyboard.press("Space");

    const act = bar(page).getByRole("button", { name: "Change role" });
    const clear = bar(page).getByRole("button", { name: "Clear selection" });
    await backUntilFocused(page, act);
    await page.keyboard.press("ArrowRight");
    await expect(clear).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Columns" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(bar(page)).toBeHidden();
    await expect(page.getByRole("searchbox", { name: "Search by name or address" })).toBeFocused();
  });

  test("each tick takes a 24-pixel press around its 16-pixel box", async ({ page, request }) => {
    await drawn(page, request);

    for (const tick of [
      page.getByRole("checkbox", { name: "Select every member on this page" }),
      tickOf(page, "Cy Twombly"),
    ]) {
      const target = await targetOf(tick);
      expect(target.drawn, "the drawn box changed size").toEqual([16, 16]);
      expect(target.missed, `a corner of the ${String(TARGET)}-pixel target misses`).toEqual([]);
    }
  });

  test("Clear filters by keyboard hands focus to the search", async ({ page, request }) => {
    await drawn(page, request);
    const search = page.getByRole("searchbox", { name: "Search by name or address" });
    await search.fill("Zed");

    const clear = page.getByRole("button", { name: "Clear filters" });
    await tabUntilFocused(page, clear);
    await page.keyboard.press("Enter");

    await expect(search).toBeFocused();
    await expect(tickOf(page, "Cy Twombly")).toBeVisible();
  });
});
