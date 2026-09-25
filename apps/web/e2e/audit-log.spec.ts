import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  anAddress,
  keystrokesListed,
  makeGroups,
  person,
  provision,
  signIn,
  skipLinkReachesTheScreen,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const AUDIT_LOG_VIEW = "/people/audit-log";

const SAID_WHEN = /^\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}$/;

const auditLog = (page: Page) => page.getByRole("region", { name: "Audit log" });

// The header row is a row too, so the events are the rows with a cell.
const eventRows = (page: Page): Locator =>
  auditLog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const familyFilter = (page: Page) => auditLog(page).getByRole("combobox", { name: "Family" });

const showOlder = (page: Page) => auditLog(page).getByRole("button", { name: "Show older events" });

const pickFamily = async (page: Page, family: string): Promise<void> => {
  await familyFilter(page).click();
  await page.getByRole("option", { name: family }).click();
};

const cellsOf = (row: Locator) => row.getByRole("cell");

// Three events by three kinds of actor, and another workspace's alongside, so a log that leaked
// would show its person.
const anAdminAtTheAuditLog = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
): Promise<{ readonly workspaceId: string; readonly adminId: string }> => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: admin });
  const { workspaceId } = workspace;

  const priya = await person(api, anAddress("priya"), { displayName: "Priya Shah" });
  await addMember(api, { workspaceId, userId: priya.id, role: "Admin" });
  await makeGroups(api, { workspaceId, userId: priya.id, names: ["Bid writers"] });

  const unnamed = await person(api, anAddress("unnamed"), { displayName: "" });
  await addMember(api, { workspaceId, userId: unnamed.id, role: "Admin" });
  await makeGroups(api, { workspaceId, userId: unnamed.id, names: ["Estimators"] });

  const elsewhere = await provision(api, { name: `Not ${workspaceName}` });
  const stranger = await person(api, anAddress("stranger"), { displayName: "Una Elsewhere" });
  await addMember(api, { workspaceId: elsewhere.workspaceId, userId: stranger.id, role: "Admin" });
  await makeGroups(api, {
    workspaceId: elsewhere.workspaceId,
    userId: stranger.id,
    names: ["Their group"],
  });

  await page.goto("/sign-in");
  await signIn(page, api, admin);
  await page
    .getByRole("navigation", { name: "Control Centre" })
    .getByRole("link", { name: "People" })
    .click();
  await page
    .getByRole("navigation", { name: "People" })
    .getByRole("link", { name: "Audit log" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${AUDIT_LOG_VIEW}$`));
  return { workspaceId, adminId: workspace.admin.id };
};

test.describe("the People screen's Audit log view", () => {
  test("shows an Admin every act in the workspace, newest first, each actor named", async ({
    page,
    request,
  }) => {
    await anAdminAtTheAuditLog(page, request, "Calder Joinery");

    await expect(
      auditLog(page).getByRole("heading", { level: 2, name: "Audit log" }),
    ).toBeVisible();
    await expect(auditLog(page)).toContainText(
      "Every act in this workspace except answers, newest first",
    );
    await expect(eventRows(page)).toHaveCount(3);
    await expect(auditLog(page).getByText("3 events.", { exact: true })).toBeVisible();

    const newest = cellsOf(eventRows(page).nth(0));
    const older = cellsOf(eventRows(page).nth(1));
    const oldest = cellsOf(eventRows(page).nth(2));
    await expect(newest.nth(0)).toHaveText(SAID_WHEN);
    await expect(newest.nth(1)).toHaveText("People");
    await expect(newest.nth(2)).toContainText("Group created");
    await expect(newest.nth(3)).toHaveText("a former member");
    await expect(older.nth(2)).toContainText("Group created");
    await expect(older.nth(3)).toHaveText("Priya Shah");
    await expect(oldest.nth(1)).toHaveText("Platform");
    await expect(oldest.nth(2)).toContainText("Workspace provisioned");
    await expect(oldest.nth(3)).toHaveText("the platform");

    await expect(page.locator("body")).not.toContainText("Una Elsewhere");
  });

  test("opens one event for what it was recorded as and what it acted on", async ({
    page,
    request,
  }) => {
    const { workspaceId } = await anAdminAtTheAuditLog(page, request, "Aire Valley Tooling");

    const oldest = eventRows(page).nth(2);
    const details = oldest.getByRole("button", { name: /^Details of Workspace provisioned/ });
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await details.click();

    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(oldest).toContainText("platform.workspace.provisioned");
    await expect(oldest).toContainText(`workspace ${workspaceId}`);
    await expect(oldest).toContainText("role");
  });

  test("reads one family at a time, and says when a family holds nothing yet", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtTheAuditLog(page, request, "Wharfe Fabrication");
    await expect(eventRows(page)).toHaveCount(3);

    await familyFilter(page).click();
    // Timed from the pick, so the budget is the read's and not the pointer's way to the list.
    const started = Date.now();
    await page.getByRole("option", { name: "People" }).click();
    await expect(eventRows(page)).toHaveCount(2);
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "family filter", description: `${elapsed} ms` });
    expect(elapsed, "the people family's events rendered past the list's budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
    await expect(auditLog(page).getByText("2 events in the people family.")).toBeVisible();

    await pickFamily(page, "Knowledge");
    await expect(auditLog(page)).toContainText("No acts in the knowledge family yet.");
    await passesTheAccessibilityGate();
    await auditLog(page).getByRole("button", { name: "Show all families" }).click();

    await expect(eventRows(page)).toHaveCount(3);
    await expect(familyFilter(page)).toHaveText("All families");
    await expect(familyFilter(page)).toBeFocused();
  });

  test("shows older events a page at a time, focus landing on the first older one", async ({
    page,
    request,
  }) => {
    const { workspaceId, adminId } = await anAdminAtTheAuditLog(page, request, "Dales Castings");
    const names = Array.from({ length: 48 }, (_, index) => `Crew ${index + 1}`);
    await makeGroups(request, { workspaceId, userId: adminId, names });

    await page.goto(AUDIT_LOG_VIEW);
    await expect(eventRows(page)).toHaveCount(50);
    await expect(
      auditLog(page).getByText("The newest 50 events; older ones follow.", { exact: true }),
    ).toBeVisible();
    await expect(cellsOf(eventRows(page).nth(49)).nth(3)).toHaveText("Priya Shah");

    await page.keyboard.press("o");

    await expect(eventRows(page)).toHaveCount(51);
    await expect(auditLog(page).getByText("51 events.", { exact: true })).toBeVisible();
    await expect(showOlder(page)).toHaveCount(0);
    await expect(
      eventRows(page)
        .nth(50)
        .getByRole("button", { name: /^Details of Workspace provisioned/ }),
    ).toBeFocused();
  });

  test("renders the log within the constitution's latency budget", async ({ page, request }) => {
    await anAdminAtTheAuditLog(page, request, "Ryedale Metalwork");

    // A fresh document, so no page of the log is already in the page's cache.
    const started = Date.now();
    await page.goto(AUDIT_LOG_VIEW);
    await expect(eventRows(page)).toHaveCount(3);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "audit log", description: `${elapsed} ms` });
    expect(elapsed, "the audit log of three events rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`refuses a member at ${role} the log, saying the refusal in its own word`, async ({
      page,
      request,
    }) => {
      await aMemberSignedInAt(page, request, role, AUDIT_LOG_VIEW);

      const refused = auditLog(page).getByRole("alert");
      await expect(refused).toContainText("Refused: role-forbids.");
      await expect(refused).toContainText("Only an Admin of this workspace reads its audit log.");
      await expect(auditLog(page).getByRole("table")).toHaveCount(0);
    });
  }

  test("lets an Admin filter, page and open the log by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtTheAuditLog(page, request, "Calder Castings");
    // A fresh document, so the first Tab starts from the top rather than from the rail's link.
    await page.goto(AUDIT_LOG_VIEW);
    await expect(eventRows(page)).toHaveCount(3);

    await skipLinkReachesTheScreen(page);

    const keystrokes = await keystrokesListed(page, "People");
    await expect(keystrokes).toContainText("Choose the family of acts to show");
    await expect(keystrokes).toContainText("Show older events");
    await page.keyboard.press("Escape");
    await expect(keystrokes).toHaveCount(0);

    await page.keyboard.press("f");
    // The list takes focus once it has placed itself; a key sent before then reaches nothing.
    await expect(page.getByRole("option", { name: "All families" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(familyFilter(page)).toHaveText("People");
    await expect(familyFilter(page)).toBeFocused();
    await expect(eventRows(page)).toHaveCount(2);

    await page.keyboard.press("Tab");
    const details = eventRows(page)
      .nth(0)
      .getByRole("button", { name: /^Details of/ });
    await expect(details).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("aria-expanded", "true");

    await expect(auditLog(page)).toMatchAriaSnapshot(`
      - region "Audit log":
        - heading "Audit log" [level=2]
        - paragraph: /Every act in this workspace except answers/
        - status: 2 events in the people family.
        - text: Family
        - combobox "Family": People
        - table /The audit log, newest first/:
          - caption: /The audit log, newest first/
          - rowgroup:
            - row "When Family Act By":
              - columnheader "When"
              - columnheader "Family"
              - columnheader "Act"
              - columnheader "By"
          - rowgroup:
            - row /Group created/:
              - cell /\\d{4}/
              - cell "People"
              - cell /Group created/:
                - text: Group created
                - button /Details of Group created/ [expanded]
                - term: Recorded as
                - definition: people.group.created
                - term: Subject
                - definition: /^group /
              - cell "a former member"
            - row /Group created/:
              - cell /\\d{4}/
              - cell "People"
              - cell /Group created/:
                - text: Group created
                - button /Details of Group created/
              - cell "Priya Shah"
    `);

    await passesTheAccessibilityGate();
  });
});
