import path from "node:path";
import { pathToFileURL } from "node:url";

import type { APIRequestContext, Page } from "@playwright/test";

import { workspaceRoot } from "@test/roots.ts";

import { expect, test } from "../browser.ts";
import { bundledHarness, harnessDrawn } from "../drawn-parts.ts";
import { tabUntilFocused } from "../harness.ts";

let parts: string | undefined;

test.beforeAll(async () => {
  parts = await bundledHarness({
    name: "list-parts",
    file: pathToFileURL(path.join(workspaceRoot, "test/support/members-list.tsx")),
    component: "MembersList",
    props: { pageSize: 2 },
  });
});

const drawn = async (page: Page, request: APIRequestContext) => {
  await harnessDrawn(page, request, { title: "Members", script: parts ?? "" });
  await expect(page.getByRole("table")).toBeVisible();
};

const bar = (page: Page) => page.getByRole("toolbar", { name: "Selected Members" });

const tickOf = (page: Page, name: string) => page.getByRole("checkbox", { name: `Select ${name}` });

const roomAtTheEdge = () => {
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
};

test.describe("the shared list parts, drawn together", () => {
  test("keep every part but the table inside 320 pixels", async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await drawn(page, request);
    await tickOf(page, "Cy Twombly").click();
    await tickOf(page, "Ada Lovelace").click();
    await expect(bar(page).getByRole("status")).toHaveText(/\b2\b/);
    await expect(page.getByRole("navigation", { name: "Pages of Members" })).toBeVisible();

    const room = await page.evaluate(roomAtTheEdge);
    expect(room.scrolls, "the page scrolls sideways").toBeLessThanOrEqual(room.holds);
    expect(room.pastTheEdge, "a part outside the table reaches past the edge").toEqual([]);
    test.info().annotations.push({
      type: "table at 320 pixels",
      description: `${String(room.tableScrolls)} px of columns in ${String(room.tableHolds)} px`,
    });
  });

  test("tick, menu and clear work by keyboard alone", async ({ page, request }) => {
    await drawn(page, request);

    await tabUntilFocused(page, tickOf(page, "Cy Twombly"));
    await page.keyboard.press("Space");
    await expect(bar(page).getByRole("status")).toHaveText(/\b1\b/);

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
});
