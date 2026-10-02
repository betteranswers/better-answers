import type { Locator, Page } from "@playwright/test";

import { EMPTY_LINES } from "@/features/people/empty-lines.ts";
import { BULK_WORDS, SELECTED_MEMBERS } from "@/features/people/member-act-words.ts";
import { ROUTES_WORDS } from "@/features/routes/words.ts";
import { NOTHING_BOUND } from "@/features/sources/words.ts";
import { CONTROL_CENTRE, groupIn, screenNamed, type Role } from "@/shared/navigation.ts";

import { theConsoleIsRefused, theSwitcherListsOneWorkspace, type Gate } from "./every-role.ts";
import { expect, test, theTestPeople } from "./fixtures.ts";
import { groupNamesOf, membershipOf } from "./reads.ts";
import { theFixtureHolds, type RepairMembers } from "./test-workspace.ts";

const people = groupIn(CONTROL_CENTRE, "people");
const MEMBERS = screenNamed(people, "Members").path;
const GROUPS = screenNamed(people, "Groups").path;
const AUDIT_LOG = screenNamed(groupIn(CONTROL_CENTRE, "system"), "Audit log").path;
const BINDINGS = screenNamed(groupIn(CONTROL_CENTRE, "sources"), "Bindings").path;
const ROUTES_AND_SPEND = screenNamed(
  groupIn(CONTROL_CENTRE, "agent-operations"),
  "Routes and spend",
).path;

/** Every group the journeys make starts so, and the opening repair deletes any left behind. */
const JOURNEYS_GROUPS = "Journeys run";

/** A row's first cell is its tick, then the person, then their role. */
const ROLE_CELL = 2;

const membersRegion = (page: Page): Locator => page.getByRole("region", { name: "Members" });

const rowOf = (page: Page, name: string): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name, exact: true }) });

const saidOnMembers = (page: Page, words: string): Locator =>
  membersRegion(page).getByRole("status").filter({ hasText: words });

const groupsRegion = (page: Page): Locator => page.getByRole("region", { name: "Groups" });

const groupButton = (page: Page, name: string): Locator =>
  groupsRegion(page).getByRole("button", { name, exact: true });

type BulkAct = { readonly act: string; readonly title: (count: number) => string };

/** Ticked on the first page, where the invented members' names sort the repair members. */
const opened = async (page: Page, names: readonly string[], bulk: BulkAct): Promise<Locator> => {
  await page.goto(MEMBERS);
  for (const name of names) {
    await membersRegion(page)
      .getByRole("checkbox", { name: `Select ${name}`, exact: true })
      .check();
  }
  await page
    .getByRole("toolbar", { name: SELECTED_MEMBERS })
    .getByRole("button", { name: bulk.act, exact: true })
    .click();
  return page.getByRole("dialog", { name: bulk.title(names.length) });
};

const chosen = async (dialog: Locator, field: string, option: string): Promise<void> => {
  await dialog.getByRole("combobox", { name: field }).click();
  await dialog.page().getByRole("option", { name: option, exact: true }).click();
};

/** A bulk act is refused while another is going, so each waits for its own outcome line. */
const rolesChanged = async (page: Page, names: readonly string[], role: Role): Promise<void> => {
  const { changeRole } = BULK_WORDS;
  const dialog = await opened(page, names, changeRole);
  await chosen(dialog, "Role", role);
  await dialog.getByRole("button", { name: changeRole.commit(names.length, role) }).click();
  await expect(saidOnMembers(page, changeRole.done(names.length, role, 0))).toBeVisible();
  for (const name of names) {
    await expect(rowOf(page, name).getByRole("cell").nth(ROLE_CELL)).toHaveText(role);
  }
};

const addedToGroup = async (page: Page, names: readonly string[], group: string) => {
  const { addToGroup } = BULK_WORDS;
  const dialog = await opened(page, names, addToGroup);
  await chosen(dialog, "Group", group);
  await dialog.getByRole("button", { name: addToGroup.commit(names.length, group) }).click();
  await expect(saidOnMembers(page, addToGroup.done(names.length, group, 0))).toBeVisible();
};

const groupMade = async (page: Page, name: string): Promise<void> => {
  await page.goto(GROUPS);
  const naming = groupsRegion(page).getByRole("textbox", { name: "Name of a new group" });
  await naming.fill(name);
  await naming.press("Enter");
  await expect(groupButton(page, name)).toBeFocused();
};

/** The sheet hides the list from the tree while open, so the list is read once it has gone. */
const groupDeleted = async (page: Page, name: string): Promise<void> => {
  await page.goto(GROUPS);
  await groupButton(page, name).click();
  const sheet = page.getByRole("dialog", { name });
  await sheet.getByRole("button", { name: `Delete ${name}` }).click();
  await page
    .getByRole("alertdialog", { name: `Delete ${name}` })
    .getByRole("button", { name: `Delete ${name}` })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(groupsRegion(page).getByRole("heading", { name: "Groups" })).toBeFocused();
  await expect(groupButton(page, name)).toHaveCount(0);
};

/** What a failed run left: a repair member still an Editor, or a group of the journeys'. */
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
  page.getByRole("navigation", { name: "Pages of members" });

/** Each turn waits for the count it says, so the next turn starts from the page it drew. */
const lastPageReached = async (page: Page): Promise<number> => {
  const next = pagesOfMembers(page).getByRole("button", { name: "Next page" });
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

/** The newest page of events, then Load more, which must bring older ones below it. */
const olderEventsLoaded = async (page: Page, gate: Gate): Promise<void> => {
  await page.goto(AUDIT_LOG);
  const auditLog = page.getByRole("region", { name: "Audit log" });
  const events = auditLog.getByRole("row").filter({ has: page.getByRole("cell") });
  const loadMore = auditLog.getByRole("button", { name: "Show older events" });
  await expect(loadMore, "the Audit log offered no Load more").toBeVisible();
  const shown = await events.count();
  await loadMore.click();
  await expect
    .poll(() => events.count(), { message: "Load more brought no older events" })
    .toBeGreaterThan(shown);
  await gate();
};

/** Only read: an act on either would upload documents or spend on models. */
const readOnlyScreensRead = async (page: Page, gate: Gate): Promise<void> => {
  await test.step("Invitations", async () => {
    await page.goto(MEMBERS);
    await page.getByRole("tab", { name: "Invitations" }).click();
    await expect(page.getByRole("region", { name: "Invitations" })).toContainText(
      EMPTY_LINES.invitations,
    );
    await gate();
  });
  await test.step("Bindings", async () => {
    await page.goto(BINDINGS);
    await expect(page.getByText(NOTHING_BOUND, { exact: true })).toBeVisible();
    await gate();
  });
  await test.step("Routes and spend", async () => {
    await page.goto(ROUTES_AND_SPEND);
    await expect(page.getByRole("region", { name: "Routes" })).toContainText(ROUTES_WORDS.lead);
  });
};

/** Named for the run, so a group a failed run leaves is told from one this run made. */
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

  await readOnlyScreensRead(page, gate);

  await test.step("The workspace switcher", async () => {
    const { workspace } = await membershipOf(page);
    await theSwitcherListsOneWorkspace(page, workspace.name);
    await gate();
  });

  await test.step("The console", () => theConsoleIsRefused(page, gate));
});
