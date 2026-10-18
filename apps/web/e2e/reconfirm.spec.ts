import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { passkeyNameFor } from "@/features/auth/account-words.ts";
import { STALE_CONFIRMATION } from "@/features/auth/refusal-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  ageTheConfirmation,
  anAddress,
  person,
  provision,
  reconfirmOf,
  reconfirmedOn,
  signIn,
} from "./harness.ts";
import { refusalAnswering } from "./refused-read.ts";
import { aVirtualAuthenticator } from "./virtual-authenticator.ts";

const people = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS_PAGE = pageNamed(people, "Members").path;

const thePage = (page: Page) => page.getByRole("main", { name: "Page" });

const membersRegion = (page: Page) => thePage(page).getByRole("region", { name: "Members" });

const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const memberLink = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("link", { name, exact: true });

const removalOf = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: "Removal", exact: true });

const roleRegion = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: "Role", exact: true });

const tickOf = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("checkbox", { name: `Select ${name}`, exact: true });

const selectionAction = (page: Page, action: string): Locator =>
  page.getByRole("toolbar", { name: "Selected Members" }).getByRole("button", { name: action });

const rowOf = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

const suggestedName = (page: Page): Promise<string> =>
  page.evaluate(() => navigator.userAgent).then(passkeyNameFor);

const aTag = (): string => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;

type AtPeople = {
  readonly adminEmail: string;
  readonly adminId: string;
};

const anAdminAtPeople = async (
  page: Page,
  api: APIRequestContext,
  tag: string,
): Promise<AtPeople> => {
  const adminEmail = anAddress(`${tag}-admin`);
  const workspace = await provision(api, { name: `Reconfirm ${tag}`, adminEmail });
  const priya = await person(api, anAddress(`${tag}-priya`), { displayName: "Priya Shah" });
  const sam = await person(api, anAddress(`${tag}-sam`), { displayName: "Sam Okoro" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: priya.id, role: "Editor" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: sam.id, role: "Viewer" });

  await page.goto("/sign-in");
  await signIn(page, api, adminEmail);
  await page.goto(MEMBERS_PAGE);
  await expect(memberRows(page)).toHaveCount(3);
  return { adminEmail, adminId: workspace.admin.id };
};

test.describe("a stale confirmation before a high-impact act", () => {
  test("asks again before removing a member, and not after", async ({ page, request }) => {
    const atPeople = await anAdminAtPeople(page, request, aTag());
    await ageTheConfirmation(request, atPeople.adminId);
    await page.goto(MEMBERS_PAGE);
    await memberLink(page, "Priya Shah").click();
    const removal = removalOf(page);

    await removal.getByRole("button", { name: "Remove Member" }).click();
    const refused = refusalAnswering(page, "members.remove");
    await removal.getByRole("button", { name: "Remove", exact: true }).click();

    expect(await refused).toMatchObject({ word: STALE_CONFIRMATION });
    await expect(page).toHaveURL(new RegExp(`${MEMBERS_PAGE}`));

    await reconfirmedOn(page, request, atPeople.adminEmail);
    await expect(memberRows(page)).toHaveCount(2);

    await memberLink(page, "Sam Okoro").click();
    await thePage(page).getByRole("radio", { name: "Editor", exact: true }).click();
    await roleRegion(page).getByRole("button", { name: "Change Role" }).click();

    await expect(reconfirmOf(page)).toHaveCount(0);
    await expect(roleRegion(page).getByRole("status")).toHaveText(/Sam Okoro.*Editor/);
  });

  test("re-confirms once for a whole bulk batch", async ({ page, request }) => {
    const atPeople = await anAdminAtPeople(page, request, aTag());
    await ageTheConfirmation(request, atPeople.adminId);
    await page.goto(MEMBERS_PAGE);
    await tickOf(page, "Priya Shah").check();
    await tickOf(page, "Sam Okoro").check();

    const refused = refusalAnswering(page, "members.bulkRemove");
    await selectionAction(page, "Remove").click();
    const dialog = page.getByRole("dialog", { name: "Remove 2 Members" });
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();

    expect(await refused).toMatchObject({ word: STALE_CONFIRMATION });

    await reconfirmedOn(page, request, atPeople.adminEmail);
    await expect(memberRows(page)).toHaveCount(1);
    await expect(reconfirmOf(page)).toHaveCount(0);
  });

  test("a Viewer adds a first passkey with no re-confirm", async ({ page, request }) => {
    await aVirtualAuthenticator(page);
    const viewerEmail = anAddress(`${aTag()}-viewer`);
    const workspace = await provision(request, { name: `Viewers ${aTag()}` });
    const viewer = await person(request, viewerEmail);
    await addMember(request, {
      workspaceId: workspace.workspaceId,
      userId: viewer.id,
      role: "Viewer",
    });

    await page.goto("/sign-in");
    await signIn(page, request, viewerEmail);
    await page.goto("/account");
    const name = await suggestedName(page);

    await page.getByRole("button", { name: "Add a Passkey" }).click();
    await page.getByRole("button", { name: "Add Passkey" }).click();

    await expect(reconfirmOf(page)).toHaveCount(0);
    await expect(rowOf(page, name)).toBeFocused();
  });
});
