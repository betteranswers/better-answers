import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { AUDIT_LOG_KEYSTROKES as KEY } from "@/features/people/audit-log/audit-log-state.ts";
import { AUDIT_LOG_WORDS } from "@/features/people/audit-log/audit-log-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { filterBy } from "@/shared/words.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  keyListed,
  keystrokesListed,
  makeGroups,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const ONE_LINE_PX = 48;

const AUDIT_LOG_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), "Audit Log").path;

const auditLog = (page: Page) => page.getByRole("region", { name: "Audit Log" });

const linesOf = (page: Page): Locator => auditLog(page).getByRole("listitem");

const searchBox = (page: Page) =>
  auditLog(page).getByRole("searchbox", { name: "Search by person, group or action" });

const familyFilter = (page: Page) =>
  auditLog(page).getByRole("combobox", { name: filterBy("Family") });

const pickFamily = async (page: Page, family: string): Promise<void> => {
  await familyFilter(page).click();
  await page.getByRole("option", { name: family }).click();
};

const detailsOf = (line: Locator) => line.getByRole("button", { name: /^Details of / });

type AtTheAuditLog = {
  readonly workspaceId: string;
  readonly adminId: string;
  readonly adminEmail: string;
  readonly priya: { readonly id: string; readonly email: string };
  readonly unnamedEmail: string;
};

const anAdminAtTheAuditLog = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
): Promise<AtTheAuditLog> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail });
  const { workspaceId } = workspace;

  const priyaEmail = anAddress("priya");
  const priya = await person(api, priyaEmail, { displayName: "Priya Shah" });
  await addMember(api, { workspaceId, userId: priya.id, role: "Admin" });
  await makeGroups(api, { workspaceId, userId: priya.id, names: ["Bid writers"] });

  const unnamedEmail = anAddress("unnamed");
  const unnamed = await person(api, unnamedEmail, { displayName: "" });
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
  await signIn(page, api, adminEmail);
  await page
    .getByRole("navigation", { name: "Control Centre" })
    .getByRole("link", { name: "Audit Log" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${AUDIT_LOG_PAGE}$`));
  return {
    workspaceId,
    adminId: workspace.admin.id,
    adminEmail,
    priya: { id: priya.id, email: priyaEmail },
    unnamedEmail,
  };
};

const aFullPageOpened = async (
  page: Page,
  api: APIRequestContext,
  at: AtTheAuditLog,
  count: number,
): Promise<void> => {
  const names = Array.from({ length: count }, (_, index) => `Crew ${index + 1}`);
  await makeGroups(api, { workspaceId: at.workspaceId, userId: at.adminId, names });
  await page.goto(AUDIT_LOG_PAGE);
  await expect(linesOf(page)).toHaveCount(50);
};

test.describe("the System group's Audit log page", () => {
  test("shows each event on one line without naming its family", async ({ page, request }) => {
    await anAdminAtTheAuditLog(page, request, "Derwent Joinery");
    await expect(linesOf(page)).toHaveCount(3);

    for (const line of await linesOf(page).all()) {
      const box = await line.boundingBox();
      expect(box?.height, "a closed event is taller than one line").toBeLessThan(ONE_LINE_PX);
    }
    for (const family of ["People", "Knowledge", "Sources", "Platform"]) {
      await expect(
        linesOf(page).filter({ hasText: new RegExp(family) }),
        `a closed event names the ${family} family`,
      ).toHaveCount(0);
    }

    await expect(familyFilter(page)).toHaveText(AUDIT_LOG_WORDS.everyFamily);
    await pickFamily(page, "Platform");
    await expect(linesOf(page)).toHaveCount(1);
    await expect(familyFilter(page)).toHaveText("Platform");
  });

  test("event details show each person's sign-in address under their name", async ({
    page,
    request,
  }) => {
    const { priya } = await anAdminAtTheAuditLog(page, request, "Aire Valley Tooling");

    const priyas = linesOf(page).nth(1);
    await expect(
      priyas,
      "a closed event shows an address for an actor whose name is unique",
    ).not.toContainText(priya.email);
    const details = detailsOf(priyas);
    await expect(details).toHaveAttribute("aria-expanded", "false");
    const restsAt = (await details.boundingBox())?.y;
    expect(restsAt, "the Details button has no position on the page").toBeDefined();
    await details.click();

    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(priyas.getByRole("definition").first()).toHaveText(`Priya Shah${priya.email}`);
    expect(
      (await details.boundingBox())?.y,
      "the Details button moved when the details opened",
    ).toBe(restsAt);

    const provisioned = linesOf(page).nth(2);
    await detailsOf(provisioned).click();
    await expect(provisioned.getByRole("term").first()).toHaveText("By");
    for (const raw of ["platform.workspace.provisioned", "process:", "human:", "Actor id"]) {
      await expect(auditLog(page), `the audit log shows ${raw}`).not.toContainText(raw);
    }
  });

  test("an Admin searches, opens, and loads older events by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await anAdminAtTheAuditLog(page, request, "Calder Castings");

    await test.step("shows the audit log within the list time budget", async () => {
      const started = Date.now();
      await page.goto(AUDIT_LOG_PAGE);
      await expect(linesOf(page)).toHaveCount(3);
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "audit log", description: `${elapsed} ms` });
      expect(
        elapsed,
        "the audit log of three events took longer than its time budget to render",
      ).toBeLessThan(LIST_BUDGET_MS);
    });

    await aFullPageOpened(page, request, at, 51);

    await skipLinkReachesThePage(page);

    const keystrokes = await keystrokesListed(page, "Audit Log");
    for (const { key } of Object.values(KEY))
      await expect(keyListed(keystrokes, key)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(keystrokes).toHaveCount(0);

    await page.keyboard.press(KEY.search.key);
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.type("Crew");
    await expect(page).toHaveURL(/audit\.search=Crew/);
    await expect(linesOf(page)).toHaveCount(50);

    await page.keyboard.press("Tab");
    await expect(familyFilter(page)).toBeFocused();
    await page.keyboard.press("Tab");
    const details = detailsOf(linesOf(page).first());
    await expect(details).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press(KEY.older.key);
    await expect(linesOf(page)).toHaveCount(51);
    await expect(
      linesOf(page).nth(50),
      "focus did not land on the first older event",
    ).toBeFocused();

    await passesTheAccessibilityGate();
  });
});
