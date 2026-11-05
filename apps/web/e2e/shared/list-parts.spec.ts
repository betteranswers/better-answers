import path from "node:path";
import { pathToFileURL } from "node:url";

import type { APIRequestContext, Page } from "@playwright/test";

import { workspaceRoot } from "@test/roots.ts";

import { expect, test } from "../browser.ts";
import { bundledHarness, harnessDrawn } from "../drawn-parts.ts";
import { tabUntilFocused } from "../harness.ts";

const LIST_BUDGET_MS = 1000;

let membersListScript: string | undefined;

test.beforeAll(async () => {
  membersListScript = await bundledHarness({
    name: "list-parts",
    file: pathToFileURL(path.join(workspaceRoot, "test/support/members-list.tsx")),
    component: "MembersList",
    props: { pageSize: 2 },
  });
});

const renderMembersList = async (page: Page, request: APIRequestContext) => {
  await harnessDrawn(page, request, { title: "Members", script: membersListScript ?? "" });
  await expect(page.getByRole("table")).toBeVisible();
};

const selectedMembersToolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "Selected Members" });

const selectCheckbox = (page: Page, name: string) =>
  page.getByRole("checkbox", { name: `Select ${name}` });

const widthsAtTheEdge = () => {
  const edge = document.documentElement.clientWidth;
  const table = document.querySelector('[data-slot="table-container"]');
  const outside = [...document.querySelectorAll("main *")].filter(
    (node) => table === null || !table.contains(node),
  );
  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: edge,
    overflowing: outside
      .filter((node) => node.getBoundingClientRect().right > edge)
      .map((node) => node.outerHTML.slice(0, 120)),
    tableScrollWidth: table?.scrollWidth ?? 0,
    tableClientWidth: table?.clientWidth ?? 0,
  };
};

test.describe("the shared list components on one page", () => {
  test("select, row menu, and clear selection work by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await test.step("renders the list within one second", async () => {
      const started = Date.now();
      await renderMembersList(page, request);
      const elapsed = Date.now() - started;
      test.info().annotations.push({ type: "list parts", description: `${elapsed} ms` });
      expect(elapsed, "the list took longer than one second to render").toBeLessThan(
        LIST_BUDGET_MS,
      );
    });

    const trigger = page.getByRole("button", { name: "Actions for Cy Twombly" });

    await test.step("selects a row and opens its Actions menu by keyboard", async () => {
      await tabUntilFocused(page, selectCheckbox(page, "Cy Twombly"));
      await page.keyboard.press("Space");
      await expect(selectedMembersToolbar(page).getByRole("status")).toHaveText(/\b1\b/);

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
    });

    await test.step("passes the accessibility gate with a row selected", async () => {
      await expect(selectedMembersToolbar(page)).toBeVisible();
      await passesTheAccessibilityGate();
    });

    await test.step("clears the selection by keyboard", async () => {
      await page.keyboard.press("x");
      await expect(selectedMembersToolbar(page)).toBeHidden();
    });

    await test.step("fits everything except the table within 320 pixels", async () => {
      await page.setViewportSize({ width: 320, height: 720 });
      await selectCheckbox(page, "Cy Twombly").click();
      await selectCheckbox(page, "Ada Lovelace").click();
      await expect(selectedMembersToolbar(page).getByRole("status")).toHaveText(/\b2\b/);
      await expect(page.getByRole("navigation", { name: "Pages of Members" })).toBeVisible();

      const widths = await page.evaluate(widthsAtTheEdge);
      expect(widths.scrollWidth, "the page scrolls sideways").toBeLessThanOrEqual(
        widths.clientWidth,
      );
      expect(
        widths.overflowing,
        "an element outside the table extends past the screen's right edge",
      ).toEqual([]);
      test.info().annotations.push({
        type: "table at 320 pixels",
        description: `${String(widths.tableScrollWidth)} px of columns in ${String(widths.tableClientWidth)} px`,
      });
    });
  });
});
