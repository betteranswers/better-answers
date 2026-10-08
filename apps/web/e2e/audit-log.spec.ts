import { readFile } from "node:fs/promises";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { AUDIT_LOG_KEYSTROKES as KEY } from "@/features/people/audit-log-state.ts";
import { AUDIT_LOG_WORDS as WORDS } from "@/features/people/audit-log-words.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { NO_RESPONSE_TO_A_READ, sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  anAddress,
  keystrokesListed,
  makeGroups,
  notFoundOfferingHome,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const system = menuGroupIn(CONTROL_CENTRE, "system");

const AUDIT_LOG = pageNamed(system, "Audit log");

const AUDIT_LOG_PAGE = AUDIT_LOG.path;

const SAID_DAY = /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+ \d{4}$/;

const auditLog = (page: Page) => page.getByRole("region", { name: WORDS.heading });

const linesOf = (page: Page): Locator => auditLog(page).getByRole("listitem");

const searchBox = (page: Page) => auditLog(page).getByRole("searchbox", { name: WORDS.search });

const familyFilter = (page: Page) =>
  auditLog(page).getByRole("combobox", { name: `Filter by ${WORDS.family.toLowerCase()}` });

const loadMore = (page: Page) => auditLog(page).getByRole("button", { name: "Load more" });

const exportButton = (page: Page) => auditLog(page).getByRole("button", { name: WORDS.export });

const said = (page: Page) => auditLog(page).getByRole("status").first();

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

/**
 * Three events by three kinds of actor, and another workspace's alongside, so an audit log that
 * leaked would show its person.
 */
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
    .getByRole("navigation", { name: CONTROL_CENTRE.name })
    .getByRole("link", { name: "Audit log" })
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

/** Groups made after the seeded three, so the newest page holds them alone. */
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
  test("shows an Admin each action as its sentence, by day", async ({ page, request }) => {
    const { unnamedEmail } = await anAdminAtTheAuditLog(page, request, "Calder Joinery");

    await expect(auditLog(page).getByRole("heading", { level: 2 })).toHaveText(WORDS.heading);
    await expect(auditLog(page)).toContainText(WORDS.summary);
    await expect(linesOf(page)).toHaveCount(3);
    await expect(said(page)).toHaveText("3 events.");
    await expect(auditLog(page).getByRole("heading", { level: 3 })).toHaveText(SAID_DAY);

    await expect(linesOf(page).nth(0)).toContainText(
      `${unnamedEmail} created the group Estimators`,
    );
    await expect(linesOf(page).nth(1)).toContainText("Priya Shah created the group Bid writers");
    await expect(linesOf(page).nth(2)).toContainText("The platform provisioned the workspace");
    await expect(linesOf(page).nth(2)).toContainText(WORDS.families.platform);

    await expect(page.locator("body")).not.toContainText("Una Elsewhere");
  });

  test("opens an event's detail, a sign-in address beneath each name", async ({
    page,
    request,
  }) => {
    const { priya } = await anAdminAtTheAuditLog(page, request, "Aire Valley Tooling");

    const priyas = linesOf(page).nth(1);
    const details = detailsOf(priyas);
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await details.click();

    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(priyas.getByRole("definition").first()).toHaveText(`Priya Shah${priya.email}`);

    const provisioned = linesOf(page).nth(2);
    await detailsOf(provisioned).click();
    await expect(provisioned.getByRole("term").first()).toHaveText(WORDS.by);
    for (const raw of ["platform.workspace.provisioned", "process:", "human:", "Actor id"]) {
      await expect(auditLog(page), `the audit log shows ${raw}`).not.toContainText(raw);
    }
  });

  test("tells apart two members of one name by their addresses", async ({ page, request }) => {
    const { workspaceId } = await anAdminAtTheAuditLog(page, request, "Swale Tooling");
    const addresses = [anAddress("sam"), anAddress("sam")];
    for (const [index, address] of addresses.entries()) {
      const sam = await person(request, address, { displayName: "Sam Okoro" });
      await addMember(request, { workspaceId, userId: sam.id, role: "Admin" });
      await makeGroups(request, { workspaceId, userId: sam.id, names: [`Crew ${index}`] });
    }

    await page.goto(AUDIT_LOG_PAGE);
    await expect(linesOf(page)).toHaveCount(5);
    for (const [line, address] of [
      [linesOf(page).nth(0), addresses[1]],
      [linesOf(page).nth(1), addresses[0]],
    ] as const) {
      await expect(line, "the address shows before the details open").toContainText(
        `Sam Okoro created the group`,
      );
      await expect(line.getByText(address ?? "", { exact: true })).toBeVisible();
    }
  });

  test("searches past the first page, and Load more keeps it", async ({ page, request }) => {
    const at = await anAdminAtTheAuditLog(page, request, "Dales Castings");
    await aFullPageOpened(page, request, at, 55);

    await searchBox(page).fill("Priya");
    await expect(linesOf(page)).toHaveCount(1);
    await expect(linesOf(page).first()).toContainText("Priya Shah created the group Bid writers");
    await expect(page).toHaveURL(/audit\.search=Priya/);

    await searchBox(page).fill("Crew");
    await expect(linesOf(page)).toHaveCount(50);
    await loadMore(page).click();
    await expect(linesOf(page)).toHaveCount(55);
    await expect(said(page)).toHaveText("55 events matching “Crew”.");
    await expect(searchBox(page)).toHaveValue("Crew");
  });

  test("keeps the search through a change of family", async ({ page, request }) => {
    await anAdminAtTheAuditLog(page, request, "Wharfe Fabrication");
    await searchBox(page).fill("Priya");
    await expect(linesOf(page)).toHaveCount(1);

    await familyFilter(page).click();
    // Timed from the pick, so the budget is the read's and not the pointer's way to the list.
    const started = Date.now();
    await page.getByRole("option", { name: WORDS.families.platform }).click();
    await expect(
      auditLog(page).getByText("No events in the platform family matching “Priya”."),
    ).toBeVisible();
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "family filter", description: `${elapsed} ms` });
    expect(elapsed, "the platform family's events rendered past the list's budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
    await expect(searchBox(page)).toHaveValue("Priya");
    await expect(page).toHaveURL(/audit\.family=platform/);

    await pickFamily(page, WORDS.families.people);
    await expect(linesOf(page)).toHaveCount(1);
  });

  test("exports what matches, and the log shows the export first", async ({ page, request }) => {
    const { adminEmail, priya } = await anAdminAtTheAuditLog(page, request, "Ryedale Exports");
    await pickFamily(page, WORDS.families.people);
    await searchBox(page).fill(priya.email);
    await expect(linesOf(page)).toHaveCount(1);

    const saving = page.waitForEvent("download");
    await exportButton(page).click();
    const download = await saving;
    const csv = await readFile(await download.path(), "utf8");
    expect(csv, "the file holds Priya's event").toContain("Priya Shah");
    expect(download.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    await expect(auditLog(page)).toContainText(`Saved 1 event to ${download.suggestedFilename()}.`);

    await searchBox(page).fill("");
    await pickFamily(page, WORDS.everyFamily);
    const exported = linesOf(page).first();
    await expect(exported).toContainText("exported 1 event from the audit log");
    await detailsOf(exported).click();
    await expect(exported.getByRole("definition").first()).toContainText(adminEmail);
    await expect(exported).toContainText(`Family${WORDS.families.people}`);
    await expect(exported).toContainText("Search matchedPriya Shah");
    await expect(exported, "the export event shows the address searched for").not.toContainText(
      priya.email,
    );
  });

  test("offers no export when nothing matches", async ({ page, request }) => {
    await anAdminAtTheAuditLog(page, request, "Holme Wire");
    const nothing = "zzz-nobody";

    await searchBox(page).fill(nothing);

    await expect(auditLog(page).getByText(`No events matching “${nothing}”.`)).toBeVisible();
    await expect(exportButton(page)).toBeDisabled();
    await auditLog(page).getByRole("button", { name: "Clear filters" }).click();
    await expect(linesOf(page)).toHaveCount(3);
    await expect(searchBox(page)).toBeFocused();
    await expect(exportButton(page)).toBeEnabled();
  });

  test("lands an old People bookmark on the Audit log", async ({ page, request }) => {
    await anAdminAtTheAuditLog(page, request, "Ouse Valley Tools");

    await page.goto("/people/audit-log");

    await expect(page).toHaveURL(new RegExp(`${AUDIT_LOG_PAGE}$`));
    await expect(linesOf(page)).toHaveCount(3);
  });

  test("renders the audit log within the latency budget", async ({ page, request }) => {
    await anAdminAtTheAuditLog(page, request, "Ryedale Metalwork");

    // A fresh document, so no page of the audit log is already in the page's cache.
    const started = Date.now();
    await page.goto(AUDIT_LOG_PAGE);
    await expect(linesOf(page)).toHaveCount(3);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "audit log", description: `${elapsed} ms` });
    expect(elapsed, "the audit log of three events rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${aRole(role)} the audit log as not found`, async ({ page, request }) => {
      await aMemberSignedInAt(page, request, role, AUDIT_LOG_PAGE);

      await notFoundOfferingHome(page, role);
      await expect(auditLog(page)).toHaveCount(0);
    });
  }

  test("keeps the filter through a failed read, and says so", async ({ page, request }) => {
    await anAdminAtTheAuditLog(page, request, "Swale Joinery");
    await expect(linesOf(page)).toHaveCount(3);
    const read = (url: URL) => url.pathname.includes("members.auditLog");
    const held = Promise.withResolvers<void>();
    await page.route(read, async (route) => {
      await held.promise;
      await route.abort();
    });

    await pickFamily(page, WORDS.families.sources);
    await expect(auditLog(page).getByText(WORDS.loading)).toBeVisible();
    held.resolve();

    // The query asks twice more before it answers, as it does of any failure with no word.
    await expect(auditLog(page).getByRole("alert")).toHaveText(sentenceOf(NO_RESPONSE_TO_A_READ));
    await expect(familyFilter(page)).toHaveText(WORDS.families.sources);
    await page.unroute(read);
    await pickFamily(page, WORDS.everyFamily);
    await expect(linesOf(page)).toHaveCount(3);
    await expect(auditLog(page).getByRole("alert")).toHaveCount(0);
  });

  test("searches, opens and pages the audit log by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await anAdminAtTheAuditLog(page, request, "Calder Castings");
    // A fresh document, so the first Tab starts from the top rather than from the rail's link.
    await aFullPageOpened(page, request, at, 51);

    await skipLinkReachesThePage(page);

    const keystrokes = await keystrokesListed(page, AUDIT_LOG.name);
    for (const keystroke of Object.values(KEY))
      await expect(keystrokes).toContainText(keystroke.action);
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
