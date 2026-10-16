import type { Locator, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed, type Role } from "@/shared/navigation.ts";
import { counted } from "@/shared/words.ts";

import { saysOfItsRead } from "../e2e/locators.ts";
import { theConsoleIsRefused, theSwitcherListsOneWorkspace, type Gate } from "./every-role.ts";
import { expect, test, theTestPeople } from "./fixtures.ts";
import {
  answeredOk,
  bulkAnswerTo,
  connectedSourcesRead,
  groupNamesOf,
  sessionMemberOf,
} from "./reads.ts";
import { theFixtureHolds, type RepairMembers } from "./test-workspace.ts";

const people = menuGroupIn(CONTROL_CENTRE, "people");
const MEMBERS = pageNamed(people, "Members").path;
const GROUPS = pageNamed(people, "Groups").path;
const AUDIT_LOG = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), "Audit Log").path;
const CONNECTED_SOURCES = pageNamed(
  menuGroupIn(CONTROL_CENTRE, "sources"),
  "Connected Sources",
).path;
const MODELS_AND_SPEND = pageNamed(menuGroupIn(CONTROL_CENTRE, "models"), "Models and Spend").path;

const JOURNEYS_GROUPS = "Journeys run";

const ROLE_CELL = 2;

const GROUPS_CELL = 3;

const membersRegion = (page: Page): Locator => page.getByRole("region", { name: "Members" });

const rowOf = (page: Page, name: string): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name, exact: true }) });

/** An outcome's status stands beside its alert. A list's count and its pages' count have none. */
const outcomeOf = (list: Locator): Locator => list.locator("output:has(+ [role='alert'])");

const groupsRegion = (page: Page): Locator => page.getByRole("region", { name: "Groups" });

const groupButton = (page: Page, name: string): Locator =>
  groupsRegion(page).getByRole("button", { name, exact: true });

type BulkAction = { readonly action: string; readonly title: (count: number) => string };

const membersTitled = (count: number): string => counted(count, "Member", "Members");

const CHANGE_ROLE: BulkAction = {
  action: "Change Role",
  title: (count) => `Change Role for ${membersTitled(count)}`,
};

const ADD_TO_GROUP: BulkAction = {
  action: "Add to Group",
  title: (count) => `Add ${membersTitled(count)} to a Group`,
};

/** Ticked on the first page, where the invented members' names sort the repair members. */
const opened = async (page: Page, names: readonly string[], bulk: BulkAction): Promise<Locator> => {
  await page.goto(MEMBERS);
  for (const name of names) {
    await membersRegion(page)
      .getByRole("checkbox", { name: `Select ${name}`, exact: true })
      .check();
  }
  await page
    .getByRole("toolbar", { name: "Selected Members" })
    .getByRole("button", { name: bulk.action, exact: true })
    .click();
  return page.getByRole("dialog", { name: bulk.title(names.length) });
};

const chosen = async (dialog: Locator, field: string, option: string): Promise<void> => {
  await dialog.getByRole("combobox", { name: field }).click();
  await dialog.page().getByRole("option", { name: option, exact: true }).click();
};

/**
 * The rows change before the api answers, and a bulk action is refused while another is going, so
 * each waits for its answer.
 */
const committed = async (
  page: Page,
  procedure: string,
  commit: Locator,
  ticked: number,
): Promise<void> => {
  const [answer] = await Promise.all([bulkAnswerTo(page, procedure), commit.click()]);
  expect(answer, `${procedure} did not change everyone ticked`).toEqual({
    changed: ticked,
    skipped: 0,
  });
  await expect(outcomeOf(membersRegion(page))).toHaveText(/\S/);
};

const rolesChanged = async (page: Page, names: readonly string[], role: Role): Promise<void> => {
  const dialog = await opened(page, names, CHANGE_ROLE);
  await chosen(dialog, "Role", role);
  const commit = dialog.getByRole("button", { name: CHANGE_ROLE.action, exact: true });
  await committed(page, "members.bulkChangeRole", commit, names.length);
  for (const name of names) {
    await expect(rowOf(page, name).getByRole("cell").nth(ROLE_CELL)).toHaveText(role);
  }
};

const addedToGroup = async (page: Page, names: readonly string[], group: string): Promise<void> => {
  const dialog = await opened(page, names, ADD_TO_GROUP);
  await chosen(dialog, "Group", group);
  const commit = dialog.getByRole("button", { name: ADD_TO_GROUP.action, exact: true });
  await committed(page, "members.bulkAddToGroup", commit, names.length);
  for (const name of names) {
    await expect(rowOf(page, name).getByRole("cell").nth(GROUPS_CELL)).toContainText(group);
  }
};

const groupMade = async (page: Page, name: string): Promise<void> => {
  await page.goto(GROUPS);
  const creating = page.getByRole("dialog", { name: "Create a Group" });
  await groupsRegion(page).getByRole("button", { name: "Create a Group" }).click();
  const naming = creating.getByRole("textbox", { name: "New Group Name" });
  await naming.fill(name);
  await naming.press("Enter");
  await expect(creating).toHaveCount(0);
  await expect(groupButton(page, name)).toBeFocused();
};

/** The sheet hides the list from the tree while open, so the list is read once it has gone. */
const groupDeleted = async (page: Page, name: string): Promise<void> => {
  await page.goto(GROUPS);
  await groupButton(page, name).click();
  const sheet = page.getByRole("dialog", { name });
  await sheet.getByRole("button", { name: "Delete Group" }).click();
  const confirm = page
    .getByRole("alertdialog", { name: `Delete ${name}` })
    .getByRole("button", { name: "Delete", exact: true });
  // The list drops the group before the api answers, and the run reads the api next.
  await Promise.all([answeredOk(page, "members.deleteGroup"), confirm.click()]);
  await expect(sheet).toHaveCount(0);
  await expect(groupsRegion(page).getByRole("heading", { name: "Groups" })).toBeFocused();
  await expect(groupButton(page, name)).toHaveCount(0);
};

const repaired = async (page: Page, repair: RepairMembers): Promise<void> => {
  if (repair.editors.length > 0) {
    await test.step("Set the repair members back to Viewer", () =>
      rolesChanged(page, repair.editors, "Viewer"));
  }
  const left = (await groupNamesOf(page)).filter((name) => name.startsWith(JOURNEYS_GROUPS));
  for (const name of left) {
    await test.step("Delete a group an earlier run left", () => groupDeleted(page, name));
  }
};

const pagesOfMembers = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Pages of Members" });

const lastPageReached = async (page: Page): Promise<number> => {
  const next = pagesOfMembers(page).getByRole("button", { name: "Next Page" });
  const said = pagesOfMembers(page).getByRole("status");
  await expect(said).toBeVisible();
  let turned = 0;
  while (await next.isEnabled()) {
    const was = await said.innerText();
    await next.click();
    await expect(said).not.toHaveText(was);
    turned += 1;
  }
  return turned;
};

const membersWalked = async (page: Page, gate: Gate): Promise<void> => {
  await test.step("Walk to the last page", async () => {
    await page.goto(MEMBERS);
    expect(await lastPageReached(page), "Members showed no second page").toBeGreaterThan(0);
    await gate();
  });
  await test.step("Open a member's page", async () => {
    const link = membersRegion(page).getByRole("row").getByRole("link").first();
    const name = await link.innerText();
    await link.click();
    await expect(
      page.getByRole("main").getByRole("heading", { level: 2, name, exact: true }),
    ).toBeVisible();
    await gate();
  });
};

const olderEventsLoaded = async (page: Page, gate: Gate): Promise<void> => {
  await page.goto(AUDIT_LOG);
  const auditLog = page.getByRole("region", { name: "Audit Log" });
  const events = auditLog.getByRole("listitem");
  const loadMore = auditLog.getByRole("button", { name: "Load More" });
  await expect(loadMore, "the Audit log offered no Load more").toBeVisible();
  const shown = await events.count();
  await loadMore.click();
  await expect
    .poll(() => events.count(), { message: "Load more brought no older events" })
    .toBeGreaterThan(shown);
  await gate();
};

/**
 * Only read: an action would upload documents or spend on models. The fixture leaves both lists
 * empty.
 */
const readOnlyPagesRead = async (page: Page, gate: Gate): Promise<void> => {
  await test.step("Invitations", async () => {
    await page.goto(MEMBERS);
    await page.getByRole("tab", { name: "Invitations" }).click();
    const rows = page
      .getByRole("region", { name: "Invitations" })
      .getByRole("row")
      .filter({ has: page.getByRole("cell") });
    // A list still loading says so in a status, and one unread in an alert.
    await expect(
      rows.filter({ hasNot: page.getByRole("status") }).filter({ hasNot: page.getByRole("alert") }),
    ).toHaveText([/\S/]);
    await expect(rows.filter({ hasText: "@" })).toHaveCount(0);
    await gate();
  });
  await test.step("Connected sources", async () => {
    const [read] = await Promise.all([connectedSourcesRead(page), page.goto(CONNECTED_SOURCES)]);
    expect(read, "the page read a connected source the fixture does not hold").toBe(0);
    const connectedSources = page.getByRole("region", { name: "Connected Sources" });
    await saysOfItsRead(connectedSources);
    await expect(connectedSources.getByRole("listitem")).toHaveCount(0);
    await gate();
  });
  await test.step("Models and spend", async () => {
    await page.goto(MODELS_AND_SPEND);
    await expect(page.getByRole("region", { name: "Model Choices" })).toBeVisible();
  });
};

const groupOfThisRun = (): string =>
  `${JOURNEYS_GROUPS} ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;

test.use({ role: "Admin" });

test("an Admin walks the Control Centre and leaves it unchanged", async ({
  page,
  passesTheAccessibilityGate: gate,
}) => {
  const repair = await test.step("The test workspace", () =>
    theFixtureHolds(page, theTestPeople()));
  await test.step("Repair what an earlier run left", () => repaired(page, repair));

  await test.step("Members", () => membersWalked(page, gate));

  await test.step("Bulk role change", async () => {
    await test.step("Make three Editors", () => rolesChanged(page, repair.names, "Editor"));
    await test.step("Make them Viewers again", () => rolesChanged(page, repair.names, "Viewer"));
    await gate();
  });

  await test.step("Groups", async () => {
    const group = groupOfThisRun();
    await test.step("Make a group for the run", () => groupMade(page, group));
    await gate();
    await test.step("Add three to it", () => addedToGroup(page, repair.names, group));
    await gate();
    await test.step("Delete it", () => groupDeleted(page, group));
    expect(await groupNamesOf(page), "the run's group outlived it").not.toContain(group);
    await gate();
  });

  await test.step("Audit log", () => olderEventsLoaded(page, gate));

  await readOnlyPagesRead(page, gate);

  await test.step("The workspace switcher", async () => {
    const { workspace } = await sessionMemberOf(page);
    await theSwitcherListsOneWorkspace(page, workspace.name, "Admin");
    await gate();
  });

  await test.step("The console", () => theConsoleIsRefused(page, gate));
});
