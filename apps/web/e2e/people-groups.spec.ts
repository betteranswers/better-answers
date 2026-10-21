import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { GROUPS_KEYSTROKES, PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  ACTION_SAMPLES,
  actionClocked,
  A_ROLE,
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextKey,
  countOf,
  keepsItsWordOffThePage,
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  makeGroups,
  notFoundOfferingHome,
  person,
  provision,
  saysARefusal,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
  theActionsLandedWithinTheirBudget,
} from "./harness.ts";
import { refusalAnswering } from "./refused-read.ts";

const LIST_BUDGET_MS = 1000;

const people = menuGroupIn(CONTROL_CENTRE, "people");

const GROUPS_PAGE = pageNamed(people, "Groups").path;

const MEMBERS_PAGE = pageNamed(people, "Members").path;

const GROUPS_CELL = 3;

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

const actionBeside = (keystrokes: Locator, key: string): Locator =>
  keystrokes
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${key}$`) })
    .locator("xpath=following-sibling::*[1]");

const countCellOf = (name: string): string => `//tr[td[1][normalize-space(.)='${name}']]/td[2]`;

const SHEET_COUNT = "//div[@role='dialog']//h2/following-sibling::p[1]";

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

const deletedAtAKey = async (page: Page, name: string, left: number): Promise<number> => {
  await groupButton(page, name).click();
  await sheetOf(page, name).getByRole("button", { name: "Delete Group" }).click();
  const confirming = page.getByRole("alertdialog", { name: `Delete ${name}` });
  await confirmedAtAKey(page, confirming, left);
  await expect(groupRows(page)).toHaveCount(left);
  return actionClocked(page);
};

const tickedGroup = (name: string): string =>
  `//fieldset//div[button[@role='checkbox'][@aria-checked='true']]//label[normalize-space(.)='${name}']`;

const ONE_GAP_PX = 16;

const startsUnderItsHeader = async (card: Locator): Promise<void> => {
  const header = await card.locator("[data-slot='card-header']").boundingBox();
  const firstLine = await card.getByRole("paragraph").first().boundingBox();
  const headerEnds = (header?.y ?? Number.NaN) + (header?.height ?? Number.NaN);
  expect(
    (firstLine?.y ?? Number.NaN) - headerEnds,
    "an empty band stands above the card's first line of text",
  ).toBeLessThanOrEqual(ONE_GAP_PX);
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

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${A_ROLE[role]} Groups as not found, listing none`, async ({ page, request }) => {
      const workspace = await aMemberSignedInAt(page, request, role, GROUPS_PAGE);
      await makeGroups(request, {
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        names: ["Hidden from them"],
      });
      await page.reload();

      await notFoundOfferingHome(page, role);
      await expect(groupsRegion(page)).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Hidden from them");
    });
  }
});

test.describe("a group's actions", () => {
  test("creates a group from the toolbar act's dialog", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Aire Valley Tooling");

    await groupsRegion(page).getByRole("button", { name: "Create a Group" }).click();
    await nameField(page).fill("Site leads");
    await clockTheNextKey(page, { at: countCellOf("Site leads"), reads: "0" });
    await nameField(page).press("Enter");

    await theActionLandedWithinItsBudget(page, "create a group");
    await expect(createDialog(page)).toHaveCount(0);
    await expect(groupButton(page, "Site leads")).toBeFocused();
    await expect(groupsRegion(page).getByRole("status").filter({ hasText: /\S/ })).toHaveText([
      /\b3\b/,
      /Site leads/,
    ]);

    await page.reload();
    await expect(rowOf(page, "Site leads").getByRole("cell").nth(1)).toHaveText(/^0\b/);
  });

  test("tells an Admin a name is taken, and what next", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Wharfe Fabrication");

    await groupsRegion(page).getByRole("button", { name: "Create a Group" }).click();
    await nameField(page).fill("HR team");
    const refused = refusalAnswering(page, "members.createGroup");
    await createDialog(page).getByRole("button", { name: "Create Group" }).click();

    expect(await refused).toMatchObject({ word: "name-taken" });
    await saysARefusal(createDialog(page).getByRole("alert"));
    await keepsItsWordOffThePage(page, "name-taken");
    await expect(nameField(page)).toHaveValue("HR team");
    await createDialog(page).getByRole("button", { name: "Close" }).click();
    await expect(groupRows(page)).toHaveCount(2);

    await page.keyboard.press(GROUPS_KEYSTROKES.create.key);
    await expect(nameField(page)).toBeFocused();
    await expect(
      createDialog(page).getByRole("alert"),
      "the last refusal greets the reader",
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(createDialog(page)).toHaveCount(0);
    await passesTheAccessibilityGate();
  });

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

  test("renames a group from its row menu, in place", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Nidd Mills");

    const renaming = await renamingFromTheRowMenu(page, "HR team");
    const name = renaming.getByRole("textbox", { name: "Name" });
    await name.fill("People team");
    await clockTheNextKey(page, { at: countCellOf("People team"), reads: "2" });
    await name.press("Enter");

    await theActionLandedWithinItsBudget(page, "rename a group");
    await expect(renaming).toHaveCount(0);
    await expect(rowOf(page, "People team").getByRole("cell").nth(1)).toHaveText(/^2\b/);
    await expect(groupsRegion(page).getByRole("status").filter({ hasText: /\S/ })).toHaveText([
      /\b2\b/,
      /HR team.*People team/,
    ]);
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

  test("lets an Admin rename a group, and members' rows follow", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Nidd Valley Casting");

    await groupButton(page, "HR team").click();
    const sheet = sheetOf(page, "HR team");
    await expect(sheet.getByRole("heading", { level: 2, name: "HR team" })).toBeFocused();
    const renaming = sheet.getByRole("region", { name: "Rename" });
    await renaming.getByRole("textbox", { name: "Name" }).fill("People team");
    await clockTheNextKey(page, { at: "//div[@role='dialog']//h2", reads: "People team" });
    await renaming.getByRole("textbox", { name: "Name" }).press("Enter");

    const renamed = sheetOf(page, "People team");
    await expect(renamed.getByRole("region", { name: "Rename" }).getByRole("status")).toHaveText(
      /HR team.*People team/,
    );
    await theActionLandedWithinItsBudget(page, "rename a group");
    await page.keyboard.press("Escape");
    await expect(groupButton(page, "People team")).toBeFocused();
    await expect(rowOf(page, "People team").getByRole("cell").nth(1)).toHaveText(/^2\b/);

    await nav(page).getByRole("link", { name: "Members" }).click();
    const priya = page
      .getByRole("region", { name: "Members" })
      .getByRole("row")
      .filter({ hasText: "Priya Shah" });
    await expect(priya.getByRole("cell").nth(GROUPS_CELL)).toHaveText("People team");
  });

  test("an Admin deletes a group once told what it takes", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const shifts = Array.from(
      { length: ACTION_SAMPLES - 1 },
      (_unused, at) => `Shift ${String(at + 1)}`,
    );
    await anAdminAtGroups(page, request, "Ure Mill Tools", shifts);
    const samples: number[] = [];
    for (const [at, name] of shifts.entries()) {
      samples.push(await deletedAtAKey(page, name, 1 + shifts.length - at));
    }

    await groupButton(page, "HR team").click();
    const sheet = sheetOf(page, "HR team");
    await expect(
      sheet.getByRole("region", { name: "Delete" }).getByRole("paragraph"),
      "the card counts no member the deletion takes",
    ).toHaveText(/\b2\b/);
    await sheet.getByRole("button", { name: "Delete Group" }).click();

    const confirming = await warnedOfDeleting(page, "HR team", 2);
    await passesTheAccessibilityGate();
    await confirmedAtAKey(page, confirming, 1);

    await expect(sheet).toHaveCount(0);
    samples.push(await actionClocked(page));
    theActionsLandedWithinTheirBudget("delete a group", samples);
    await expect(groupRows(page)).toHaveCount(1);
    await expect(groupsRegion(page).getByRole("status").filter({ hasText: /\S/ })).toHaveText([
      /\b1\b/,
      /HR team/,
    ]);
    await expect(groupsRegion(page).getByRole("heading", { name: "Groups" })).toBeFocused();

    await page.reload();
    await expect(groupRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Bid writers")).toBeVisible();
  });

  test("lets an Admin put members in a group, and out", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Swale Forge");

    await groupButton(page, "Bid writers").click();
    const sheet = sheetOf(page, "Bid writers");
    const members = sheet.getByRole("group", { name: "Members of Bid writers" });
    const said = sheet
      .getByRole("region", { name: "Members" })
      .getByRole("status")
      .filter({ hasText: /\S/ });
    await expect(members.getByRole("checkbox")).toHaveCount(3);
    await expect(members.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await startsUnderItsHeader(sheet.getByRole("region", { name: "Members" }));

    const sam = members.getByRole("checkbox", { name: "Sam Okoro" });
    await sam.focus();
    await clockTheNextKey(page, { at: SHEET_COUNT, reads: "1" });
    await page.keyboard.press("Space");

    await expect(said).toHaveText(/Sam Okoro.*Bid writers/);
    const saidOfTheAdd = await said.innerText();
    await theActionLandedWithinItsBudget(page, "put a member in a group");
    await expect(sam).toBeChecked();
    await expect(sam).toBeFocused();

    await expect(sheet).toMatchAriaSnapshot(`
      - dialog "Bid writers":
        - heading "Bid writers" [level=2]
        - paragraph: /\\b1\\b/
        - region "Members":
          - heading "Members" [level=3]
          - status: /Sam Okoro.*Bid writers/
          - group "Members of Bid writers":
            - checkbox "Priya Shah"
            - checkbox "Sam Okoro" [checked]
            - checkbox "Test person"
        - region "Rename":
          - heading "Rename" [level=3]
          - textbox "Name": Bid writers
          - button "Rename Group"
        - region "Delete":
          - heading "Delete" [level=3]
          - button "Delete Group"
        - button "Close"
    `);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(rowOf(page, "Bid writers").getByRole("cell").nth(1)).toHaveText(/^1\b/);

    await groupButton(page, "Bid writers").click();
    await sam.focus();
    await clockTheNextKey(page, { at: SHEET_COUNT, reads: "0" });
    await page.keyboard.press("Space");
    await expect(said).toHaveText(/Sam Okoro.*Bid writers/);
    await expect(said, "the status says of taking him out what it said of the add").not.toHaveText(
      saidOfTheAdd,
    );
    await expect(sam).not.toBeChecked();
    await theActionLandedWithinItsBudget(page, "take a member out of a group");
    await page.keyboard.press("Escape");
    await expect(rowOf(page, "Bid writers").getByRole("cell").nth(1)).toHaveText(/^0\b/);
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

test.describe("a group's row menu by keyboard", () => {
  test("renames a group, and focus returns to the menu's trigger", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Calder Weir");
    await expect(groupRows(page)).toHaveCount(2);

    await tabUntilFocused(
      page,
      rowOf(page, "HR team").getByRole("button", { name: "Actions for HR team" }),
    );
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Rename" }).focus();
    await page.keyboard.press("Enter");

    const renaming = page.getByRole("dialog", { name: "Rename HR team" });
    await expect(renaming.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("People team");
    await clockTheNextKey(page, { at: countCellOf("People team"), reads: "2" });
    await renaming.getByRole("button", { name: "Rename Group" }).press("Enter");

    await theActionLandedWithinItsBudget(page, "rename a group from its row menu");
    await expect(renaming).toHaveCount(0);
    await expect(
      rowOf(page, "People team").getByRole("button", { name: "Actions for People team" }),
      "focus did not return to the menu's trigger",
    ).toBeFocused();
    await expect(rowOf(page, "People team").getByRole("cell").nth(1)).toHaveText(/^2\b/);
    await passesTheAccessibilityGate();
  });
});

test.describe("the keystrokes listed across the People group", () => {
  test("changes the keystrokes listed on moving from Members to Groups", async ({
    page,
    request,
  }) => {
    await anAdminAtGroups(page, request, "Calder Mills");
    await nav(page).getByRole("link", { name: "Members" }).click();
    await expect(page).toHaveURL(new RegExp(`${MEMBERS_PAGE}$`));

    const onMembers = await keystrokesListed(page, "Members");
    await expect(keyListed(onMembers, PEOPLE_KEYSTROKES.changeRole.key)).toBeVisible();
    const doneOnMembers = await actionBeside(onMembers, PEOPLE_KEYSTROKES.remove.key).innerText();
    await keystrokesDismissed(page, onMembers);

    await nav(page).getByRole("link", { name: "Groups" }).click();
    await expect(groupRows(page)).toHaveCount(2);
    const onGroups = await keystrokesListed(page, "Groups");
    await expect(keyListed(onGroups, GROUPS_KEYSTROKES.changeMembers.key)).toBeVisible();
    await expect(
      keyListed(onGroups, PEOPLE_KEYSTROKES.changeRole.key),
      "Members' keystrokes outlived the page",
    ).toHaveCount(0);
    const doneOnGroups = actionBeside(onGroups, GROUPS_KEYSTROKES.delete.key);
    await expect(doneOnGroups).toHaveText(/\S/);
    await expect(doneOnGroups, "the shared key is listed with Members' action").not.toHaveText(
      doneOnMembers,
    );
  });
});

test.describe("a member's groups, on their row and their page", () => {
  test("lets an Admin change a member's groups from their page", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Esk Presswork");
    await page.goto(MEMBERS_PAGE);
    const members = page.getByRole("region", { name: "Members" });
    const priyaRow = members.getByRole("row").filter({ hasText: "Priya Shah" });
    await expect(members.getByRole("columnheader", { name: "Groups" })).toBeVisible();
    await expect(priyaRow.getByRole("cell").nth(GROUPS_CELL)).toHaveText("HR team");

    const keystrokes = await keystrokesListed(page, "Members");
    for (const { key } of [PEOPLE_KEYSTROKES.changeGroups, PEOPLE_KEYSTROKES.remove]) {
      await expect(keyListed(keystrokes, key)).toBeVisible();
    }
    await expect(
      keyListed(keystrokes, GROUPS_KEYSTROKES.changeMembers.key),
      "the Groups page's keystrokes on Members",
    ).toHaveCount(0);
    await keystrokesDismissed(page, keystrokes);

    await members.getByRole("link", { name: "Priya Shah", exact: true }).focus();
    await page.keyboard.press("g");
    const memberPage = page.getByRole("main");
    const groups = memberPage.getByRole("region", { name: "Groups", exact: true });
    const picked = memberPage.getByRole("group", { name: "Groups for Priya Shah" });
    const bids = picked.getByRole("checkbox", { name: "Bid writers" });
    await expect(bids).toBeFocused();
    await expect(bids).not.toBeChecked();
    await expect(picked.getByRole("checkbox", { name: "HR team" })).toBeChecked();
    await startsUnderItsHeader(groups);

    await clockTheNextKey(page, { at: tickedGroup("Bid writers"), reads: "Bid writers" });
    await page.keyboard.press("Space");
    await expect(groups.getByRole("status").filter({ hasText: /\S/ })).toHaveText(
      /Priya Shah.*Bid writers/,
    );
    await theActionLandedWithinItsBudget(page, "put a member in a group from their page");

    await picked.getByRole("checkbox", { name: "HR team" }).click();
    await expect(groups.getByRole("status").filter({ hasText: /\S/ })).toHaveText(
      /Priya Shah.*HR team/,
    );
    await expect(groups).toMatchAriaSnapshot(`
      - region "Groups":
        - heading "Groups" [level=3]
        - status: /Priya Shah.*HR team/
        - group "Groups for Priya Shah":
          - checkbox "Bid writers" [checked]
          - checkbox "HR team"
    `);
    await expect(page.locator("body")).not.toContainText(/\bteams\b/i);
    await passesTheAccessibilityGate();

    await page.goBack();
    await expect(priyaRow.getByRole("cell").nth(GROUPS_CELL)).toHaveText("Bid writers");
    await page.reload();
    await expect(priyaRow.getByRole("cell").nth(GROUPS_CELL)).toHaveText("Bid writers");
  });

  test("points an Admin at Groups when the workspace has none", async ({ page, request }) => {
    const admin = anAddress("admin");
    await provision(request, { name: "Rye Mill", adminEmail: admin });
    await page.goto(MEMBERS_PAGE);
    await signIn(page, request, admin);

    await page
      .getByRole("region", { name: "Members" })
      .getByRole("link", { name: "Test person", exact: true })
      .click();
    const groups = page.getByRole("main").getByRole("region", { name: "Groups", exact: true });
    await expect(groups).toMatchAriaSnapshot(`
      - region "Groups":
        - /children: equal
        - heading "Groups" [level=3]
        - status
        - paragraph
        - link "Go to Groups"
    `);
    await groups.getByRole("link", { name: "Go to Groups" }).click();

    await expect(page).toHaveURL(new RegExp(`${GROUPS_PAGE}$`));
    await expect(groupsRegion(page)).toMatchAriaSnapshot(`
      - region "Groups":
        - heading "Groups" [level=2]
        - status: /\\b0\\b/
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
            - row:
              - cell /\\S/
    `);
    await expect(
      groupsRegion(page).getByRole("button"),
      "the head holds the one create act",
    ).toHaveCount(1);
    await page.keyboard.press(GROUPS_KEYSTROKES.create.key);
    await expect(nameField(page)).toBeFocused();
  });
});
