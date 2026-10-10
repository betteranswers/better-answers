import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import { bundledHarness, harnessDrawn } from "./drawn-parts.ts";
import { tabUntilFocused } from "./harness.ts";

let parts: string | undefined;

test.beforeAll(async () => {
  parts = await bundledHarness({
    name: "list-parts",
    file: new URL("../test/members-list.tsx", import.meta.url),
    component: "MembersList",
    props: { pageSize: 2 },
  });
});

/** No page draws every shared part yet, so the unit suite's Members list is drawn on its own. */
const drawn = async (page: Page, request: APIRequestContext) => {
  await harnessDrawn(page, request, { title: "Members", script: parts ?? "" });
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
      const topmost = document.elementFromPoint(
        box.left + box.width / 2 + across,
        box.top + box.height / 2 + down,
      );
      return topmost === null || !node.contains(topmost);
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

    const trigger = page.getByRole("button", { name: "Actions for Cy Twombly" });
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
            - columnheader "Actions"
        - rowgroup:
          - row /Cy Twombly/:
            - cell "Select Cy Twombly":
              - checkbox "Select Cy Twombly" [checked]
            - cell /Cy Twombly/:
              - link "Cy Twombly"
            - cell "Viewer"
            - cell "Finance"
            - cell "3 March 2026"
            - cell "Actions for Cy Twombly":
              - button "Actions for Cy Twombly"
    `);

    await page.keyboard.press("x");
    await expect(bar(page)).toBeHidden();
  });

  test("the bar takes one tab stop; Clear hands focus on", async ({ page, request }) => {
    await drawn(page, request);
    await tabUntilFocused(page, tickOf(page, "Cy Twombly"));
    await page.keyboard.press("Space");

    const action = bar(page).getByRole("button", { name: "Change role" });
    const clear = bar(page).getByRole("button", { name: "Clear selection" });
    await backUntilFocused(page, action);
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
