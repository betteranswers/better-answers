import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { screenById, viewNamed } from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextKey,
  keystrokesDismissed,
  keystrokesListed,
  makeGroups,
  person,
  provision,
  signIn,
  skipLinkReachesTheScreen,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const people = screenById("people");

const GROUPS_VIEW = viewNamed(people, "Groups").path;

const MEMBERS_VIEW = viewNamed(people, "Members").path;

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

/** A group being created is a name before it is a button, so its row is found by its text. */
const countCellOf = (name: string): string => `//tr[td[1][normalize-space(.)='${name}']]/td[2]`;

/** What the open sheet says under its heading: a group's member count. */
const SHEET_COUNT = "//div[@role='dialog']//h2/following-sibling::p[1]";

const LIST_COUNT = "//section[h2[normalize-space(.)='Groups']]/output";

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

  // Asked for before signing in, so the sign-in screen carries the Admin back to it.
  await page.goto(GROUPS_VIEW);
  await signIn(page, api, adminEmail);
  await expect(page).toHaveURL(new RegExp(`${GROUPS_VIEW}$`));
  await expect(groupRows(page)).toHaveCount(2);
};

test.describe("the People screen's Groups view", () => {
  test("shows an Admin each group's count, and no one else's", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Calder Joinery");

    await expect(
      page.getByRole("navigation", { name: "People" }).getByRole("link", { name: "Groups" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Una's crew");
    await expect(groupsRegion(page)).toMatchAriaSnapshot(`
      - region "Groups":
        - heading "Groups" [level=2]
        - status: 2 groups
        - form "Create a group":
          - textbox "Name of a new group"
          - button "Create the group"
        - table:
          - caption: /Groups in this workspace/
          - rowgroup:
            - row "Group Members":
              - columnheader "Group"
              - columnheader "Members"
          - rowgroup:
            - row /Bid writers/:
              - cell "Bid writers":
                - button "Bid writers"
              - cell "0 members"
            - row /HR team/:
              - cell "HR team":
                - button "HR team"
              - cell "2 members"
    `);
    await passesTheAccessibilityGate();
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Dales Engineering");

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto(GROUPS_VIEW);
    await expect(groupRows(page)).toHaveCount(2);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "groups list", description: `${elapsed} ms` });
    expect(elapsed, "the list of two groups rendered past its budget").toBeLessThan(LIST_BUDGET_MS);
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`refuses a member at ${role} the groups, in its word`, async ({ page, request }) => {
      const workspace = await aMemberSignedInAt(page, request, role, GROUPS_VIEW);
      await makeGroups(request, {
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        names: ["Hidden from them"],
      });
      await page.reload();

      const refused = groupsRegion(page).getByRole("alert");
      await expect(refused).toContainText("Refused: role-forbids.");
      await expect(refused).toContainText("Only an Admin of this workspace sees its groups.");
      await expect(groupsRegion(page).getByRole("table")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Hidden from them");
    });
  }
});

test.describe("a group's acts", () => {
  test("lets an Admin create a group that lands at once", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Aire Valley Tooling");

    await nameField(page).fill("Site leads");
    await clockTheNextKey(page, { at: countCellOf("Site leads"), reads: "0 members" });
    await nameField(page).press("Enter");

    await theActLandedWithinItsBudget(page, "create a group");
    await expect(groupButton(page, "Site leads")).toBeFocused();
    await expect(groupsRegion(page).getByRole("status")).toHaveText([
      "3 groups",
      "Site leads is created.",
    ]);
    await expect(nameField(page)).toHaveValue("");

    await page.reload();
    await expect(rowOf(page, "Site leads").getByRole("cell").nth(1)).toHaveText("0 members");
  });

  test("tells an Admin a name is taken, and what next", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Wharfe Fabrication");

    await nameField(page).fill("HR team");
    await groupsRegion(page).getByRole("button", { name: "Create the group" }).click();

    const refused = groupsRegion(page).getByRole("alert");
    await expect(refused).toContainText("Refused: name-taken.");
    await expect(refused).toContainText("Choose another name.");
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
      "HR team is People team now.",
    );
    await theActLandedWithinItsBudget(page, "rename a group");
    await page.keyboard.press("Escape");
    await expect(groupButton(page, "People team")).toBeFocused();
    await expect(rowOf(page, "People team").getByRole("cell").nth(1)).toHaveText("2 members");

    await page
      .getByRole("navigation", { name: "People" })
      .getByRole("link", { name: "Members" })
      .click();
    const priya = page
      .getByRole("region", { name: "Members" })
      .getByRole("row")
      .filter({ hasText: "Priya Shah" });
    await expect(priya.getByRole("cell").nth(2)).toHaveText("People team");
  });

  test("lets an Admin delete a group after saying what it takes", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Ure Mill Tools");

    await groupButton(page, "HR team").click();
    const sheet = sheetOf(page, "HR team");
    await expect(sheet.getByRole("region", { name: "Delete" })).toContainText(
      "Deleting HR team takes its 2 members out of it, and cannot be undone.",
    );
    await sheet.getByRole("button", { name: "Delete HR team" }).click();

    const confirming = page.getByRole("alertdialog", { name: "Delete HR team" });
    await expect(confirming).toContainText("Recorded on the audit log under your name.");
    await expect(confirming.getByRole("button", { name: "Keep HR team" })).toBeFocused();
    await passesTheAccessibilityGate();
    await confirming.getByRole("button", { name: "Delete HR team" }).focus();
    await clockTheNextKey(page, { at: LIST_COUNT, reads: "1 group" });
    await page.keyboard.press("Enter");

    await expect(sheet).toHaveCount(0);
    await theActLandedWithinItsBudget(page, "delete a group");
    await expect(groupRows(page)).toHaveCount(1);
    await expect(groupsRegion(page).getByRole("status")).toHaveText([
      "1 group",
      "HR team is deleted.",
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
    const said = sheet.getByRole("region", { name: "Members" }).getByRole("status");
    await expect(members.getByRole("checkbox")).toHaveCount(3);
    await expect(members.getByRole("checkbox", { checked: true })).toHaveCount(0);

    const sam = members.getByRole("checkbox", { name: "Sam Okoro" });
    await sam.focus();
    await clockTheNextKey(page, { at: SHEET_COUNT, reads: "1 member" });
    await page.keyboard.press("Space");

    await expect(said).toHaveText("Sam Okoro is in Bid writers now.");
    await theActLandedWithinItsBudget(page, "put a member in a group");
    await expect(sam).toBeChecked();
    await expect(sam).toBeFocused();

    await expect(sheet).toMatchAriaSnapshot(`
      - dialog "Bid writers":
        - heading "Bid writers" [level=2]
        - paragraph: 1 member
        - region "Members":
          - heading "Members" [level=3]
          - status: Sam Okoro is in Bid writers now.
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
    await expect(rowOf(page, "Bid writers").getByRole("cell").nth(1)).toHaveText("1 member");

    await groupButton(page, "Bid writers").click();
    await sam.focus();
    await clockTheNextKey(page, { at: SHEET_COUNT, reads: "0 members" });
    await page.keyboard.press("Space");
    await expect(said).toHaveText("Sam Okoro is out of Bid writers now.");
    await theActLandedWithinItsBudget(page, "take a member out of a group");
    await page.keyboard.press("Escape");
    await expect(rowOf(page, "Bid writers").getByRole("cell").nth(1)).toHaveText("0 members");
  });

  test("lets an Admin reach every group act by keyboard alone", async ({ page, request }) => {
    await anAdminAtGroups(page, request, "Calder Castings");
    // A fresh document, so the first Tab starts from the top rather than from the rail's link.
    await page.goto(GROUPS_VIEW);
    await expect(groupRows(page)).toHaveCount(2);
    await skipLinkReachesTheScreen(page);

    const keystrokes = await keystrokesListed(page, people.name);
    for (const act of [
      "Create a group",
      "Open the group in focus",
      "Change the members of the group in focus",
      "Rename the group in focus",
      "Delete the group in focus",
    ]) {
      await expect(keystrokes).toContainText(act);
    }
    // `d` removes a member on the Members view; here it deletes a group, and says only that.
    await expect(keystrokes).not.toContainText("Remove the member in focus");
    await keystrokesDismissed(page, keystrokes);

    await page.keyboard.press("o");
    await expect(groupsRegion(page)).toContainText(
      "Move focus to a group first: the keystroke acts on the group in focus.",
    );

    await page.keyboard.press("n");
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.type("Site leads");
    await page.keyboard.press("Enter");
    await expect(groupButton(page, "Site leads")).toBeFocused();

    await page.keyboard.press("m");
    const sheet = sheetOf(page, "Site leads");
    await expect(sheet.getByRole("checkbox", { name: "Priya Shah" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(sheet.getByRole("region", { name: "Members" }).getByRole("status")).toHaveText(
      "Priya Shah is in Site leads now.",
    );
    await page.keyboard.press("Escape");
    await expect(groupButton(page, "Site leads")).toBeFocused();
    await expect(rowOf(page, "Site leads").getByRole("cell").nth(1)).toHaveText("1 member");

    await page.keyboard.press("r");
    await expect(sheet.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Site managers");
    await page.keyboard.press("Enter");
    const renamed = sheetOf(page, "Site managers");
    await expect(renamed.getByRole("region", { name: "Rename" }).getByRole("status")).toHaveText(
      "Site leads is Site managers now.",
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

test.describe("a member's groups, on their row and their sheet", () => {
  test("lets an Admin change a member's groups from their sheet", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtGroups(page, request, "Esk Presswork");
    await page.goto(MEMBERS_VIEW);
    const members = page.getByRole("region", { name: "Members" });
    const priyaRow = members.getByRole("row").filter({ hasText: "Priya Shah" });
    await expect(members.getByRole("columnheader", { name: "Groups" })).toBeVisible();
    await expect(priyaRow.getByRole("cell").nth(2)).toHaveText("HR team");

    const keystrokes = await keystrokesListed(page, people.name);
    await expect(keystrokes).toContainText("Change the groups of the member in focus");
    await expect(keystrokes).toContainText("Remove the member in focus");
    await expect(keystrokes).not.toContainText("Delete the group in focus");
    await keystrokesDismissed(page, keystrokes);

    await members.getByRole("button", { name: "Priya Shah", exact: true }).focus();
    await page.keyboard.press("g");
    const sheet = sheetOf(page, "Priya Shah");
    const picked = sheet.getByRole("group", { name: "Groups Priya Shah is in" });
    const bids = picked.getByRole("checkbox", { name: "Bid writers" });
    await expect(bids).toBeFocused();
    await expect(bids).not.toBeChecked();
    await expect(picked.getByRole("checkbox", { name: "HR team" })).toBeChecked();

    await clockTheNextKey(page, {
      at: "//div[@role='dialog']//dt[normalize-space(.)='Groups']/following-sibling::dd[1]",
      reads: "Bid writers",
    });
    await page.keyboard.press("Space");
    await expect(sheet.getByRole("region", { name: "Groups" }).getByRole("status")).toHaveText(
      "Priya Shah is in Bid writers now.",
    );
    await theActLandedWithinItsBudget(page, "put a member in a group from their sheet");

    await picked.getByRole("checkbox", { name: "HR team" }).click();
    await expect(sheet.getByRole("region", { name: "Groups" }).getByRole("status")).toHaveText(
      "Priya Shah is out of HR team now.",
    );
    await expect(sheet.getByRole("region", { name: "Groups" })).toMatchAriaSnapshot(`
      - region "Groups":
        - heading "Groups" [level=3]
        - status: Priya Shah is out of HR team now.
        - group "Groups Priya Shah is in":
          - checkbox "Bid writers" [checked]
          - checkbox "HR team"
    `);
    await expect(page.locator("body")).not.toContainText(/\bteams\b/i);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Escape");
    await expect(members.getByRole("button", { name: "Priya Shah", exact: true })).toBeFocused();
    await expect(priyaRow.getByRole("cell").nth(2)).toHaveText("Bid writers");
    await page.reload();
    await expect(priyaRow.getByRole("cell").nth(2)).toHaveText("Bid writers");
  });

  test("points an Admin at Groups when the workspace has none", async ({ page, request }) => {
    const admin = anAddress("admin");
    await provision(request, { name: "Rye Mill", adminEmail: admin });
    await page.goto(MEMBERS_VIEW);
    await signIn(page, request, admin);

    await page
      .getByRole("region", { name: "Members" })
      .getByRole("button", { name: "Test person", exact: true })
      .click();
    const groups = sheetOf(page, "Test person").getByRole("region", { name: "Groups" });
    await expect(groups).toContainText("No groups in this workspace yet.");
    await groups.getByRole("link", { name: "Create one on the Groups view" }).click();

    await expect(page).toHaveURL(new RegExp(`${GROUPS_VIEW}$`));
    await expect(groupsRegion(page)).toMatchAriaSnapshot(`
      - region "Groups":
        - heading "Groups" [level=2]
        - status: 0 groups
        - form "Create a group":
          - textbox "Name of a new group"
          - button "Create the group"
        - table:
          - rowgroup:
            - row "Group Members"
          - rowgroup:
            - row:
              - cell /No groups in this workspace yet\\./:
                - button "Name the first group"
    `);
    await groupsRegion(page).getByRole("button", { name: "Name the first group" }).click();
    await expect(nameField(page)).toBeFocused();
  });
});
