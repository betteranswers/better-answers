import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { GROUPS_KEYSTROKES, PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  makeGroups,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const people = menuGroupIn(CONTROL_CENTRE, "people");

const GROUPS_PAGE = pageNamed(people, "Groups").path;

const nav = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const groupsRegion = (page: Page) => page.getByRole("region", { name: "Groups" });

const groupRows = (page: Page): Locator =>
  groupsRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator =>
  groupRows(page).filter({ has: page.getByRole("button", { name, exact: true }) });

const groupButton = (page: Page, name: string): Locator =>
  groupsRegion(page).getByRole("button", { name, exact: true });

const createDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Create a Group" });

const nameField = (page: Page): Locator =>
  createDialog(page).getByRole("textbox", { name: "New Group Name" });

const sheetOf = (page: Page, name: string): Locator => page.getByRole("dialog", { name });

const renameDialog = (page: Page, name: string): Locator =>
  page.getByRole("dialog", { name: `Rename ${name}` });

const LIST_COUNT = "//section[h2[normalize-space(.)='Groups']]/div/output";

const anAdminAtGroups = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
  emptyGroups: readonly string[] = [],
) => {
  const adminEmail = anAddress("admin");
  const [workspace, priya, sam] = await Promise.all([
    provision(api, { name: workspaceName, adminEmail }),
    person(api, anAddress("priya"), { displayName: "Priya Shah" }),
    person(api, anAddress("sam"), { displayName: "Sam Okoro" }),
  ]);
  const { workspaceId } = workspace;
  await addMember(api, { workspaceId, userId: priya.id, role: "Editor" });
  await addMember(api, { workspaceId, userId: sam.id, role: "Viewer" });
  const userId = workspace.admin.id;
  await makeGroups(api, { workspaceId, userId, names: ["HR team"], memberIds: [priya.id, sam.id] });
  await makeGroups(api, { workspaceId, userId, names: ["Bid writers", ...emptyGroups] });

  const elsewhere = await provision(api, { name: `Not ${workspaceName}` });
  await makeGroups(api, {
    workspaceId: elsewhere.workspaceId,
    userId: elsewhere.admin.id,
    names: ["Una's crew"],
  });

  await page.goto(GROUPS_PAGE);
  await signIn(page, api, adminEmail);
  await expect(page).toHaveURL(new RegExp(`${GROUPS_PAGE}$`));
  await expect(groupRows(page)).toHaveCount(2 + emptyGroups.length);
};

test.describe("the People group's Groups page", () => {
  test("shows an Admin each group's count, and no one else's", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Calder Joinery");

    await expect(nav(page).getByRole("link", { name: "Groups" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading "People" [level=1]
        - paragraph
        - region "Groups":
          - heading "Groups" [level=2]
          - status: /\\b2\\b/
    `);
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Una's crew");
    await expect(groupsRegion(page)).toMatchAriaSnapshot(`
      - region "Groups":
        - heading "Groups" [level=2]
        - status: /\\b2\\b/
        - button "Create a Group"
        - status
        - searchbox "Search by name"
        - table:
          - caption
          - rowgroup:
            - row /Group Members/:
              - columnheader "Group"
              - columnheader "Members"
              - columnheader "Actions"
          - rowgroup:
            - row /Bid writers/:
              - cell "Bid writers":
                - button "Bid writers"
              - cell /\\b0\\b/
              - cell:
                - button "Actions for Bid writers"
            - row /HR team/:
              - cell "HR team":
                - button "HR team"
              - cell /\\b2\\b/
              - cell:
                - button "Actions for HR team"
    `);
    for (const name of ["Bid writers", "HR team"]) {
      const opens = groupsRegion(page).getByRole("button", { name, exact: true });
      await expect(opens).toHaveAttribute("aria-haspopup", "dialog");
      await expect(opens.locator("svg"), `${name} shows no cue that it opens`).toBeVisible();
    }
    await passesTheAccessibilityGate();
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Dales Engineering");

    const started = Date.now();
    await page.goto(GROUPS_PAGE);
    await expect(groupRows(page)).toHaveCount(2);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "groups list", description: `${elapsed} ms` });
    expect(elapsed, "the list of two groups rendered past its budget").toBeLessThan(LIST_BUDGET_MS);
  });
});

test.describe("a group's actions", () => {
  test("lets an Admin reach every group action by keyboard alone", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Calder Castings");
    await page.goto(GROUPS_PAGE);
    await expect(groupRows(page)).toHaveCount(2);
    await skipLinkReachesThePage(page);

    const keystrokes = await keystrokesListed(page, "Groups");
    for (const { key } of Object.values(GROUPS_KEYSTROKES)) {
      await expect(keyListed(keystrokes, key)).toBeVisible();
    }
    await expect(
      keyListed(keystrokes, PEOPLE_KEYSTROKES.changeRole.key),
      "the Members page's keystrokes on Groups",
    ).toHaveCount(0);
    await keystrokesDismissed(page, keystrokes);

    const saying = groupsRegion(page).getByRole("status").filter({ hasText: /\S/ });
    await expect(saying, "only the count says anything at rest").toHaveCount(1);
    await page.keyboard.press("o");
    await expect(saying, "a keystroke with no group in focus says nothing").toHaveCount(2);

    await page.keyboard.press("n");
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.type("Site leads");
    await page.keyboard.press("Enter");
    await expect(groupButton(page, "Site leads")).toBeFocused();

    await page.keyboard.press("m");
    const sheet = sheetOf(page, "Site leads");
    await expect(sheet.getByRole("checkbox", { name: "Priya Shah" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(
      sheet.getByRole("region", { name: "Members" }).getByRole("status").filter({ hasText: /\S/ }),
    ).toHaveText(/Priya Shah.*Site leads/);
    await page.keyboard.press("Escape");
    await expect(groupButton(page, "Site leads")).toBeFocused();
    await expect(rowOf(page, "Site leads").getByRole("cell").nth(1)).toHaveText(/^1\b/);

    await page.keyboard.press("r");
    await expect(sheet.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Site managers");
    await page.keyboard.press("Enter");
    const renamed = sheetOf(page, "Site managers");
    await expect(renamed.getByRole("region", { name: "Rename" }).getByRole("status")).toHaveText(
      /Site leads.*Site managers/,
    );
    await page.keyboard.press("Escape");
    await expect(groupButton(page, "Site managers")).toBeFocused();

    await page.keyboard.press("d");
    await expect(renamed.getByRole("button", { name: "Delete Group" })).toBeFocused();
    await page.keyboard.press("Enter");
    const confirming = page.getByRole("alertdialog", { name: "Delete Site managers" });
    await expect(confirming.getByRole("button", { name: "Keep Group" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirming.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(groupRows(page)).toHaveCount(2);
    await expect(groupsRegion(page).getByRole("heading", { name: "Groups" })).toBeFocused();
  });
});
