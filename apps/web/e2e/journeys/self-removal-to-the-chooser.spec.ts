import type { APIRequestContext, Page } from "@playwright/test";

import { BULK_WORDS } from "@/features/people/member-action-words.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  avatarOf,
  failMemberReadUntil,
  person,
  provision,
  signIn,
} from "../harness.ts";
import { MEMBERS_PAGE, memberRows, outcomeOf, selectionAction, tickOf } from "../people-pages.ts";

const removeSelectedMembers = async (page: Page, dialogName: string): Promise<void> => {
  await selectionAction(page, "Remove").click();
  await page
    .getByRole("dialog", { name: dialogName })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
};

const removeSelf = async (page: Page): Promise<void> => {
  await tickOf(page, "Test person").check();
  await removeSelectedMembers(page, BULK_WORDS.remove.title(1));
};

const signInAsOneOfTwoAdmins = async (
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

test.describe("bulk actions on selected members", () => {
  test("self-removal waits for the Admin's role, then opens Your Workspaces", async ({
    page,
    request,
  }) => {
    const workspace = await signInAsOneOfTwoAdmins(page, request, "Esk Cordage");
    for (const name of ["Ure Cordage", "Nidd Cordage"]) {
      const other = await provision(request, { name });
      await addMember(request, {
        workspaceId: other.workspaceId,
        userId: workspace.admin.id,
        role: "Viewer",
      });
    }
    const memberLoad = Promise.withResolvers<void>();
    await failMemberReadUntil(page, memberLoad.promise);
    await page.reload();
    await expect(memberRows(page)).toHaveCount(2);

    await tickOf(page, "Test person").check();
    await expect(outcomeOf(page)).toHaveText("");
    await selectionAction(page, "Remove").click();
    await expect(
      outcomeOf(page),
      "clicking Remove showed no status while the Admin's role loaded",
    ).toHaveText(/\S/);
    await expect(
      page.getByRole("dialog"),
      "a confirmation opened before the Admin's role loaded",
    ).toHaveCount(0);
    memberLoad.resolve();
    await expect(avatarOf(page, "Test person")).toBeVisible();

    await removeSelf(page);

    await expect(page).toHaveURL(/\/choose-workspace$/);
  });
});
