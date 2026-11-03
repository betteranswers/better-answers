import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  avatarOf,
  memberUnreadUntil,
  person,
  provision,
  signIn,
} from "../harness.ts";

const MEMBERS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members").path;

const membersRegion = (page: Page) => page.getByRole("region", { name: "Members" });

const outcomeOf = (page: Page): Locator => membersRegion(page).getByRole("status").nth(1);

const selectionBar = (page: Page): Locator =>
  page.getByRole("toolbar", { name: "Selected Members" });

const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const tickOf = (page: Page, name: string) =>
  membersRegion(page).getByRole("checkbox", { name: `Select ${name}`, exact: true });

const selectionAction = (page: Page, action: string): Locator =>
  selectionBar(page).getByRole("button", { name: action, exact: true });

const removedThroughTheBar = async (page: Page, titled: string): Promise<void> => {
  await selectionAction(page, "Remove").click();
  await page
    .getByRole("dialog", { name: titled })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
};

const removedThemselfThroughTheBar = async (page: Page): Promise<void> => {
  await tickOf(page, "Test person").check();
  await removedThroughTheBar(page, "Remove 1 Member");
};

const anAdminBesideAnotherAtPeople = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
) => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: admin });
  const successor = await person(api, anAddress("ada"), { displayName: "Ada Hartley" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: successor.id, role: "Admin" });
  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, admin);
  await expect(memberRows(page)).toHaveCount(2);
  return workspace;
};

test.describe("bulk actions on the members ticked", () => {
  test("removing yourself before your membership reads lands on the chooser", async ({
    page,
    request,
  }) => {
    const workspace = await anAdminBesideAnotherAtPeople(page, request, "Esk Cordage");
    for (const name of ["Ure Cordage", "Nidd Cordage"]) {
      const other = await provision(request, { name });
      await addMember(request, {
        workspaceId: other.workspaceId,
        userId: workspace.admin.id,
        role: "Viewer",
      });
    }
    const read = Promise.withResolvers<void>();
    await memberUnreadUntil(page, read.promise);
    await page.reload();
    await expect(memberRows(page)).toHaveCount(2);

    await tickOf(page, "Test person").check();
    await expect(outcomeOf(page)).toHaveText("");
    await selectionAction(page, "Remove").click();
    await expect(outcomeOf(page), "Remove says to wait for your role").toHaveText(/\S/);
    await expect(page.getByRole("dialog"), "no confirmation opens unread").toHaveCount(0);
    read.resolve();
    await expect(avatarOf(page, "Test person")).toBeVisible();

    await removedThemselfThroughTheBar(page);

    await expect(page).toHaveURL(/\/choose-workspace$/);
  });
});
