import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { GROUPS_KEYSTROKES, PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextKey,
  keepsItsWordOffThePage,
  keystrokesDismissed,
  keystrokesListed,
  makeGroups,
  notFoundOfferingHome,
  person,
  provision,
  saysARefusal,
  signIn,
  skipLinkReachesThePage,
  theActionLandedWithinItsBudget,
} from "./harness.ts";
import { refusalAnswering } from "./refused-read.ts";

const LIST_BUDGET_MS = 1000;

const people = menuGroupIn(CONTROL_CENTRE, "people");

const GROUPS = pageNamed(people, "Groups");

const GROUPS_PAGE = GROUPS.path;

const MEMBERS = pageNamed(people, "Members");

const MEMBERS_PAGE = MEMBERS.path;

/** A member's row leads with its tick, then the person and their role. */
const GROUPS_CELL = 3;

const nav = (page: Page) => page.getByRole("navigation", { name: CONTROL_CENTRE.name });

const groupsRegion = (page: Page) => page.getByRole("region", { name: "Groups" });

/** The header row is a row too, so the groups are the rows with a cell. */
const groupRows = (page: Page): Locator =>
  groupsRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator =>
  groupRows(page).filter({ has: page.getByRole("button", { name, exact: true }) });

const groupButton = (page: Page, name: string): Locator =>
  groupsRegion(page).getByRole("button", { name, exact: true });

const nameField = (page: Page): Locator =>
  groupsRegion(page).getByRole("textbox", { name: "Name of a new group" });

const sheetOf = (page: Page, name: string): Locator => page.getByRole("dialog", { name });

/** The action a keystroke list sets beside a key: the definition after the key's term. */
const actionBeside = (keystrokes: Locator, key: string): Locator =>
  keystrokes
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${key}$`) })
    .locator("xpath=following-sibling::*[1]");

/** A group being created is a name before it is a button, so its row is found by its text. */
const countCellOf = (name: string): string => `//tr[td[1][normalize-space(.)='${name}']]/td[2]`;

/** What the open sheet says under its heading: a group's member count. */
const SHEET_COUNT = "//div[@role='dialog']//h2/following-sibling::p[1]";

const LIST_COUNT = "//section[h2[normalize-space(.)='Groups']]/div/output";

/** A group's label on a member's page, found only while the box beside it is ticked. */
const tickedGroup = (name: string): string =>
  `//fieldset//div[button[@role='checkbox'][@aria-checked='true']]//label[normalize-space(.)='${name}']`;

/** A card's inner gap and a little over: text further beneath its header has a band above it. */
const ONE_GAP_PX = 16;

/** An empty outcome line that took a gap of its own would push the card's first text down. */
const startsUnderItsHeader = async (card: Locator): Promise<void> => {
  const header = await card.locator("[data-slot='card-header']").boundingBox();
  const firstLine = await card.getByRole("paragraph").first().boundingBox();
  const headerEnds = (header?.y ?? Number.NaN) + (header?.height ?? Number.NaN);
  expect(
    (firstLine?.y ?? Number.NaN) - headerEnds,
    "an empty band stands above the card's first line of text",
  ).toBeLessThanOrEqual(ONE_GAP_PX);
};

/** Another workspace's group is made alongside, so a list that leaked would show it. */
const anAdminAtGroups = async (page: Page, api: APIRequestContext, workspaceName: string) => {
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
  await makeGroups(api, { workspaceId, userId, names: ["Bid writers"] });

  const elsewhere = await provision(api, { name: `Not ${workspaceName}` });
  await makeGroups(api, {
    workspaceId: elsewhere.workspaceId,
    userId: elsewhere.admin.id,
    names: ["Una's crew"],
  });

  // Asked for before signing in, so the sign-in page carries the Admin back to it.
  await page.goto(GROUPS_PAGE);
  await signIn(page, api, adminEmail);
  await expect(page).toHaveURL(new RegExp(`${GROUPS_PAGE}$`));
  await expect(groupRows(page)).toHaveCount(2);
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
    // With no tabs to name the list, its own heading shows, under the page's.
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${JSON.stringify(people.name)} [level=1]
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
        - form "Create a group":
          - textbox "Name of a new group"
          - button "Create the group"
        - table:
          - caption
          - rowgroup:
            - row "Group Members":
              - columnheader "Group"
              - columnheader "Members"
          - rowgroup:
            - row /Bid writers/:
              - cell "Bid writers":
                - button "Bid writers"
              - cell /\\b0\\b/
            - row /HR team/:
              - cell "HR team":
                - button "HR team"
              - cell /\\b2\\b/
    `);
    // A name alone does not say that its row opens, so each name carries a caret at rest.
    for (const name of ["Bid writers", "HR team"]) {
      const opens = groupsRegion(page).getByRole("button", { name, exact: true });
      await expect(opens).toHaveAttribute("aria-haspopup", "dialog");
      await expect(opens.locator("svg"), `${name} shows no cue that it opens`).toBeVisible();
    }
    await passesTheAccessibilityGate();
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Dales Engineering");

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto(GROUPS_PAGE);
    await expect(groupRows(page)).toHaveCount(2);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "groups list", description: `${elapsed} ms` });
    expect(elapsed, "the list of two groups rendered past its budget").toBeLessThan(LIST_BUDGET_MS);
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${aRole(role)} Groups as not found, listing none`, async ({ page, request }) => {
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
  test("lets an Admin create a group that lands at once", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Aire Valley Tooling");

    await nameField(page).fill("Site leads");
    await clockTheNextKey(page, { at: countCellOf("Site leads"), reads: "0" });
    await nameField(page).press("Enter");

    await theActionLandedWithinItsBudget(page, "create a group");
    await expect(groupButton(page, "Site leads")).toBeFocused();
    await expect(groupsRegion(page).getByRole("status").filter({ hasText: /\S/ })).toHaveText([
      /\b3\b/,
      /Site leads/,
    ]);
    await expect(nameField(page)).toHaveValue("");

    await page.reload();
    await expect(rowOf(page, "Site leads").getByRole("cell").nth(1)).toHaveText(/^0\b/);
  });

  test("tells an Admin a name is taken, and what next", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Wharfe Fabrication");

    await nameField(page).fill("HR team");
    const refused = refusalAnswering(page, "members.createGroup");
    await groupsRegion(page).getByRole("button", { name: "Create the group" }).click();

    expect(await refused).toMatchObject({ word: "name-taken" });
    await saysARefusal(groupsRegion(page).getByRole("alert"));
    await keepsItsWordOffThePage(page, "name-taken");
    await expect(nameField(page)).toHaveValue("HR team");
    await expect(groupRows(page)).toHaveCount(2);
    await passesTheAccessibilityGate();
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
    await anAdminAtGroups(page, request, "Ure Mill Tools");

    await groupButton(page, "HR team").click();
    const sheet = sheetOf(page, "HR team");
    await expect(
      sheet.getByRole("region", { name: "Delete" }).getByRole("paragraph"),
      "the card counts no member the deletion takes",
    ).toHaveText(/\b2\b/);
    await sheet.getByRole("button", { name: "Delete HR team" }).click();

    const confirming = page.getByRole("alertdialog", { name: "Delete HR team" });
    await expect(
      confirming,
      "the confirmation counts no member the deletion takes",
    ).toHaveAccessibleDescription(/\b2\b/);
    await expect(confirming.getByRole("button", { name: "Keep HR team" })).toBeFocused();
    await passesTheAccessibilityGate();
    await confirming.getByRole("button", { name: "Delete HR team" }).focus();
    await clockTheNextKey(page, { at: LIST_COUNT, reads: "1" });
    await page.keyboard.press("Enter");

    await expect(sheet).toHaveCount(0);
    await theActionLandedWithinItsBudget(page, "delete a group");
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
          - button "Rename Bid writers"
        - region "Delete":
          - heading "Delete" [level=3]
          - button "Delete Bid writers"
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

  test("lets an Admin reach every group action by keyboard alone", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Calder Castings");
    // A fresh document, so the first Tab starts from the top rather than from the rail's link.
    await page.goto(GROUPS_PAGE);
    await expect(groupRows(page)).toHaveCount(2);
    await skipLinkReachesThePage(page);

    const keystrokes = await keystrokesListed(page, GROUPS.name);
    for (const { key } of Object.values(GROUPS_KEYSTROKES)) {
      await expect(keystrokes.getByRole("term").getByText(key, { exact: true })).toBeVisible();
    }
    await expect(
      keystrokes.getByRole("term").getByText(PEOPLE_KEYSTROKES.changeRole.key, { exact: true }),
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
    await expect(renamed.getByRole("button", { name: "Delete Site managers" })).toBeFocused();
    await page.keyboard.press("Enter");
    const confirming = page.getByRole("alertdialog", { name: "Delete Site managers" });
    await expect(confirming.getByRole("button", { name: "Keep Site managers" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirming.getByRole("button", { name: "Delete Site managers" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(groupRows(page)).toHaveCount(2);
    await expect(groupsRegion(page).getByRole("heading", { name: "Groups" })).toBeFocused();
  });
});

test.describe("the keystrokes listed across the People group", () => {
  test("changes the keystrokes listed on moving from Members to Groups", async ({
    page,
    request,
  }) => {
    await anAdminAtGroups(page, request, "Calder Mills");
    await nav(page).getByRole("link", { name: MEMBERS.name }).click();
    await expect(page).toHaveURL(new RegExp(`${MEMBERS_PAGE}$`));

    const onMembers = await keystrokesListed(page, MEMBERS.name);
    await expect(
      onMembers.getByRole("term").getByText(PEOPLE_KEYSTROKES.changeRole.key, { exact: true }),
    ).toBeVisible();
    const doneOnMembers = await actionBeside(onMembers, PEOPLE_KEYSTROKES.remove.key).innerText();
    await keystrokesDismissed(page, onMembers);

    await nav(page).getByRole("link", { name: GROUPS.name }).click();
    await expect(groupRows(page)).toHaveCount(2);
    const onGroups = await keystrokesListed(page, GROUPS.name);
    await expect(
      onGroups.getByRole("term").getByText(GROUPS_KEYSTROKES.changeMembers.key, { exact: true }),
    ).toBeVisible();
    await expect(
      onGroups.getByRole("term").getByText(PEOPLE_KEYSTROKES.changeRole.key, { exact: true }),
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

    const keystrokes = await keystrokesListed(page, MEMBERS.name);
    for (const { key } of [PEOPLE_KEYSTROKES.changeGroups, PEOPLE_KEYSTROKES.remove]) {
      await expect(keystrokes.getByRole("term").getByText(key, { exact: true })).toBeVisible();
    }
    await expect(
      keystrokes.getByRole("term").getByText(GROUPS_KEYSTROKES.changeMembers.key, { exact: true }),
      "the Groups page's keystrokes on Members",
    ).toHaveCount(0);
    await keystrokesDismissed(page, keystrokes);

    await members.getByRole("link", { name: "Priya Shah", exact: true }).focus();
    await page.keyboard.press("g");
    const memberPage = page.getByRole("main");
    const groups = memberPage.getByRole("region", { name: "Groups", exact: true });
    const picked = memberPage.getByRole("group", { name: "Groups Priya Shah is in" });
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
        - group "Groups Priya Shah is in":
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
    // The page has no way to create a group, so its empty state carries the one action.
    await expect(groups).toMatchAriaSnapshot(`
      - region "Groups":
        - /children: equal
        - heading "Groups" [level=3]
        - status
        - paragraph
        - link "Create one on the Groups page"
    `);
    await groups.getByRole("link", { name: "Create one on the Groups page" }).click();

    await expect(page).toHaveURL(new RegExp(`${GROUPS_PAGE}$`));
    await expect(groupsRegion(page)).toMatchAriaSnapshot(`
      - region "Groups":
        - heading "Groups" [level=2]
        - status: /\\b0\\b/
        - form "${GROUPS_KEYSTROKES.create.action}":
          - textbox "Name of a new group"
          - button "Create the group"
        - table:
          - rowgroup:
            - row "Group Members"
          - rowgroup:
            - row:
              - cell /\\S/
    `);
    await expect(
      groupsRegion(page).getByRole("button"),
      "the form above holds the one create action",
    ).toHaveCount(1);
    await page.keyboard.press(GROUPS_KEYSTROKES.create.key);
    await expect(nameField(page)).toBeFocused();
  });
});
