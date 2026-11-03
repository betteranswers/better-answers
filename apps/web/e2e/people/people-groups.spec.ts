import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { GROUPS_KEYSTROKES, PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  countOf,
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

const searchBox = (page: Page): Locator =>
  groupsRegion(page).getByRole("searchbox", { name: "Search by name" });

const renameDialog = (page: Page, name: string): Locator =>
  page.getByRole("dialog", { name: `Rename ${name}` });

const renamingFromTheRowMenu = async (page: Page, name: string): Promise<Locator> => {
  await rowOf(page, name)
    .getByRole("button", { name: `Actions for ${name}` })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  return renameDialog(page, name);
};

const LIST_COUNT = "//section[h2[normalize-space(.)='Groups']]/div/output";

const warnedOfDeleting = async (page: Page, name: string, members: number) => {
  const confirming = page.getByRole("alertdialog", { name: `Delete ${name}` });
  await expect(
    confirming,
    "the confirmation counts no member the deletion takes",
  ).toHaveAccessibleDescription(new RegExp(`\\b${String(members)}\\b`));
  await expect(confirming.getByRole("button", { name: "Keep Group" })).toBeFocused();
  return confirming;
};

const confirmedAtAKey = async (page: Page, confirming: Locator, left: number) => {
  await confirming.getByRole("button", { name: "Delete", exact: true }).focus();
  await clockTheNextKey(page, { at: LIST_COUNT, reads: String(left) });
  await page.keyboard.press("Enter");
};

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
  test("searches the groups by name, then clears the search", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Aire Weir");

    await page.keyboard.press(GROUPS_KEYSTROKES.search.key);
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.type("HR");
    await expect(rowOf(page, "HR team")).toHaveCount(1);
    await expect(rowOf(page, "Bid writers")).toHaveCount(0);
    await expect(countOf(groupsRegion(page))).toHaveText(/1 of 2 groups match/);
    await expect(page).toHaveURL(/groups\.search=HR/);

    await searchBox(page).fill("Payroll");
    await expect(rowOf(page, "HR team")).toHaveCount(0);
    await expect(groupsRegion(page).locator("[data-slot='empty-title']")).toHaveText(
      /No results found/,
    );
    await groupsRegion(page).getByRole("button", { name: "Clear Search" }).click();
    await expect(groupRows(page)).toHaveCount(2);
    await expect(searchBox(page), "the clear left focus on the page").toBeFocused();
    await expect(countOf(groupsRegion(page))).toHaveText(/\b2\b/);
  });

  test("takes a search written into the address by hand", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Ure Weir", ["Team 42"]);

    await page.goto(`${GROUPS_PAGE}?groups.search=42`);

    await expect(searchBox(page)).toHaveValue("42");
    await expect(rowOf(page, "Team 42")).toHaveCount(1);
    await expect(countOf(groupsRegion(page))).toHaveText(/1 of 3 groups match/);
  });

  test("keeps search focus as a created row leaves and returns", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Esk Weir");
    await groupsRegion(page).getByRole("button", { name: "Create a Group" }).click();
    await nameField(page).fill("Site leads");
    await nameField(page).press("Enter");
    await expect(groupButton(page, "Site leads")).toBeFocused();

    await searchBox(page).fill("Bid");
    await expect(rowOf(page, "Site leads")).toHaveCount(0);
    await searchBox(page).fill("");

    await expect(rowOf(page, "Site leads")).toHaveCount(1);
    await expect(searchBox(page), "the returning row took focus").toBeFocused();
  });

  test("focuses the heading once a rename hides the row", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Ure Weir");
    await searchBox(page).fill("HR");
    await expect(groupRows(page)).toHaveCount(1);

    const renaming = await renamingFromTheRowMenu(page, "HR team");
    const name = renaming.getByRole("textbox", { name: "Name" });
    await name.fill("People team");
    await name.press("Enter");

    await expect(renaming).toHaveCount(0);
    await expect(rowOf(page, "People team"), "the search let the renamed row through").toHaveCount(
      0,
    );
    await expect(
      groupsRegion(page).getByRole("heading", { name: "Groups" }),
      "focus fell off the page",
    ).toBeFocused();
  });

  test("says the group already has the name, dialog open", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Swale Weir");
    const renaming = await renamingFromTheRowMenu(page, "HR team");

    await renaming.getByRole("textbox", { name: "Name" }).press("Enter");

    await expect(renaming.getByRole("status")).toHaveText(/already called HR team/);
    await expect(renaming.getByRole("textbox", { name: "Name" })).toHaveValue("HR team");
    await page.keyboard.press("Escape");
    await expect(renaming).toHaveCount(0);
    await expect(
      rowOf(page, "HR team").getByRole("button", { name: "Actions for HR team" }),
    ).toBeFocused();
    await expect(
      groupsRegion(page).getByRole("status").filter({ hasText: /\S/ }),
      "the dialog's line reached the page",
    ).toHaveCount(1);
  });

  test("deletes a group from its row menu, warned first", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Ure Forge");

    await rowOf(page, "HR team").getByRole("button", { name: "Actions for HR team" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const confirming = await warnedOfDeleting(page, "HR team", 2);
    await confirmedAtAKey(page, confirming, 1);

    await expect(confirming).toHaveCount(0);
    await expect(groupRows(page)).toHaveCount(1);
    await expect(groupsRegion(page).getByRole("heading", { name: "Groups" })).toBeFocused();
    await expect(groupsRegion(page).getByRole("status").filter({ hasText: /\S/ })).toHaveText([
      /\b1\b/,
      /HR team/,
    ]);

    await page.reload();
    await expect(groupRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Bid writers")).toBeVisible();
  });

  test("opens no group by key after focus leaves the list", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Calder Moulds");
    const saying = groupsRegion(page).getByRole("status").filter({ hasText: /\S/ });
    await expect(saying, "only the count says anything at rest").toHaveCount(1);
    await groupButton(page, "HR team").focus();
    await groupsRegion(page).getByRole("heading", { level: 2, name: "Groups" }).focus();

    await page.keyboard.press(GROUPS_KEYSTROKES.open.key);
    await expect(saying, "a keystroke with no group in focus says nothing").toHaveCount(2);
    await expect(sheetOf(page, "HR team")).toHaveCount(0);
  });

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
