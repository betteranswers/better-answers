import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { JUMP_TO, SKIP_TO_MAIN, TOGGLE } from "@/app/words.ts";
import { WORKSPACES_WORDS } from "@/features/console/list-words.ts";
import { WORKSPACES_KEYSTROKES } from "@/features/console/people-keystrokes.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { CONSOLE, HOMES, menuGroupIn, pageById } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  avatarOf,
  crumbOf,
  markTheOperator,
  navOf,
  provision,
  railOf,
  signedInAtHome,
  skipLinkReachesThePage,
  switcherOf,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const EVERY_WORKSPACE = HOMES.operator.path;

const listOf = (page: Page) =>
  page.getByRole("region", {
    name: pageById(menuGroupIn(CONSOLE, "workspaces"), "every-workspace").name,
  });

const searchOf = (page: Page) =>
  listOf(page).getByRole("searchbox", { name: "Search by name or short name" });

const workspaceRows = (page: Page): Locator =>
  listOf(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator =>
  workspaceRows(page).filter({
    has: page.getByRole("button", { name: WORKSPACES_WORDS.moreAbout(name), exact: true }),
  });

const aNameOfItsOwn = (name: string): string =>
  `${name} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const theOperator = async (page: Page, api: APIRequestContext, workspaceName: string) => {
  const email = anAddress("operator");
  const workspace = await provision(api, {
    name: aNameOfItsOwn(workspaceName),
    adminEmail: email,
  });
  await markTheOperator(api, email);
  await signedInAtHome(page, api, email);
  return workspace;
};

test.describe("the console's Workspaces page", () => {
  test("works by keyboard and is announced as a table", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const workspace = await theOperator(page, request, "Pendle Toolworks");
    const ours = rowOf(page, workspace.name);

    await test.step("renders the list within one second", async () => {
      const started = Date.now();
      await page.goto(EVERY_WORKSPACE);
      await expect(ours).toBeVisible();
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "workspaces list", description: `${elapsed} ms` });
      expect(elapsed, "the workspaces list took longer than one second to render").toBeLessThan(
        LIST_BUDGET_MS,
      );
    });

    await test.step("does not scroll sideways at 320 pixels", async () => {
      const desktop = page.viewportSize();
      assert.ok(desktop !== null, "the page has no viewport");
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(EVERY_WORKSPACE);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: pageById(menuGroupIn(CONSOLE, "workspaces"), "every-workspace").name,
        }),
      ).toBeVisible();
      await expect(ours).toBeVisible();

      await expect(listOf(page).getByRole("columnheader")).toHaveText([
        "Workspace",
        WORKSPACES_WORDS.columns.shortName,
      ]);
      const room = {
        page: await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        table: await page
          .locator("[data-slot=table-container]")
          .evaluate((table) => table.scrollWidth - table.clientWidth),
      };
      expect(room, "the page or its table scrolls sideways").toEqual({
        page: 0,
        table: 0,
      });

      await listOf(page).getByRole("button", { name: "Columns" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Members" }).click();
      await page.keyboard.press("Escape");
      await expect(ours.getByRole("cell").nth(2)).toHaveText(/\b1\b/);

      await page.setViewportSize(desktop);
      await page.goto(EVERY_WORKSPACE);
      await expect(ours).toBeVisible();
    });

    await skipLinkReachesThePage(page);

    await page.getByRole("link", { name: SKIP_TO_MAIN }).focus();
    for (const stop of [
      page.getByRole("banner").getByRole("link", { name: "better-answers" }),
      switcherOf(page, "Console"),
      page.getByRole("button", { name: TOGGLE.hide }),
      crumbOf(page, "Console"),
      crumbOf(page, "Workspaces"),
      page.getByRole("banner").getByRole("button", { name: JUMP_TO.name }),
      avatarOf(page, workspace.admin.name),
      railOf(page).getByRole("link", { name: "Console" }),
      railOf(page).getByRole("button", { name: KEYSTROKE_WORDS.button }),
    ]) {
      await page.keyboard.press("Tab");
      await expect(stop).toBeFocused();
    }
    for (const name of [
      "Everyone",
      pageById(menuGroupIn(CONSOLE, "people"), "flagged-names").name,
      pageById(menuGroupIn(CONSOLE, "workspaces"), "every-workspace").name,
    ]) {
      await page.keyboard.press("Tab");
      await expect(navOf(page, "Console").getByRole("link", { name })).toBeFocused();
    }

    await expect(railOf(page)).toMatchAriaSnapshot(`
      - navigation "Areas":
        - list:
          - listitem:
            - link "Console"
        - button ${JSON.stringify(KEYSTROKE_WORDS.button)}
    `);

    await page.keyboard.press(WORKSPACES_KEYSTROKES.search.key);
    await expect(searchOf(page)).toBeFocused();
    await page.keyboard.type(workspace.name);
    await expect(workspaceRows(page)).toHaveCount(1);
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${JSON.stringify(pageById(menuGroupIn(CONSOLE, "workspaces"), "every-workspace").name)} [level=1]
        - region ${JSON.stringify(pageById(menuGroupIn(CONSOLE, "workspaces"), "every-workspace").name)}:
          - heading ${JSON.stringify(pageById(menuGroupIn(CONSOLE, "workspaces"), "every-workspace").name)} [level=2]
          - status: /\\b1\\b/
          - searchbox "Search by name or short name": ${JSON.stringify(workspace.name)}
          - table:
            - caption
            - rowgroup:
              - row ${JSON.stringify(Object.values(WORKSPACES_WORDS.columns).join(" "))}:
                - columnheader "Workspace"
                - columnheader ${JSON.stringify(WORKSPACES_WORDS.columns.shortName)}
                - columnheader "Members"
                - columnheader "Created"
            - rowgroup:
              - row /${workspace.name}/:
                - cell /${workspace.name}/:
                  - button ${JSON.stringify(WORKSPACES_WORDS.moreAbout(workspace.name))}
                - cell ${JSON.stringify(workspace.shortName)}
                - cell /\\b1\\b/
                - cell /\\d{1,2} [A-Z][a-z]+ \\d{4}/
    `);

    await passesTheAccessibilityGate();

    const more = ours.getByRole("button", { name: WORKSPACES_WORDS.moreAbout(workspace.name) });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(ours.getByText(workspace.workspaceId, { exact: true })).toBeVisible();
  });
});
