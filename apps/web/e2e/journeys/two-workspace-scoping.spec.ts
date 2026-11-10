import type { APIRequestContext, BrowserContext, Locator, Page } from "@playwright/test";

import { MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  inTwoWorkspaces,
  pageHidesRefusalWord,
  landedAtHome,
  person,
  alertHasText,
  switched,
  switcherOf,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const MEMBERS = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members");

const SWITCHED = { word: "workspace-switched", class: "conflict" } as const;

type Role = "Admin" | "Editor" | "Viewer";

type Workspace = { readonly workspaceId: string; readonly name: string };

type Two = { readonly first: Workspace; readonly second: Workspace };

const membersRegion = (page: Page): Locator => page.getByRole("region", { name: "Members" });

const roleOf = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("row").filter({ hasText: name }).getByRole("cell").nth(2);

const removalOf = (samsPage: Locator): Locator =>
  samsPage.getByRole("region", { name: "Removal", exact: true });

const aMemberOfBoth = async (
  api: APIRequestContext,
  { first, second }: Two,
  name: string,
  roles: { readonly first: Role; readonly second: Role },
): Promise<string> => {
  const member = await person(api, anAddress("both"), { displayName: name });
  await addMember(api, { workspaceId: first.workspaceId, userId: member.id, role: roles.first });
  await addMember(api, { workspaceId: second.workspaceId, userId: member.id, role: roles.second });
  return member.id;
};

const switchedInAnotherTab = async (
  context: BrowserContext,
  page: Page,
  { first, second }: Two,
): Promise<Page> => {
  const elsewhere = await context.newPage();
  await elsewhere.goto(MEMBERS.path);
  await switched(elsewhere, first.name, second.name);
  await landedAtHome(elsewhere, "Admin");
  await expect(switcherOf(elsewhere, second.name)).toBeVisible();
  await expect(
    switcherOf(page, first.name),
    "the first tab left the first workspace",
  ).toBeVisible();
  return elsewhere;
};

const membersReadAfresh = async (tab: Page, here: Workspace): Promise<void> => {
  await tab.goto(MEMBERS.path);
  await expect(switcherOf(tab, here.name)).toBeVisible();
};

const backIn = async (elsewhere: Page, { first, second }: Two): Promise<void> => {
  await switched(elsewhere, second.name, first.name);
  await expect(switcherOf(elsewhere, first.name)).toBeVisible();
  await membersReadAfresh(elsewhere, first);
};

const landedHomeSayingWhy = async (page: Page, now: Workspace): Promise<void> => {
  await alertHasText(page.getByRole("banner").getByRole("alert"));
  await pageHidesRefusalWord(page, SWITCHED.word);
  await landedAtHome(page, "Admin");
  await expect(
    switcherOf(page, now.name),
    "the top bar does not name the workspace the other tab switched to",
  ).toBeVisible();
};

const atSamsPage = async (page: Page, api: APIRequestContext, two: Two): Promise<Locator> => {
  const sam = await aMemberOfBoth(api, two, "Sam Okoro", { first: "Editor", second: "Viewer" });
  await page.goto(`${MEMBERS.path}/${sam}`);
  const samsPage = page.getByRole("main");
  await expect(samsPage.getByRole("heading", { level: 1, name: "Sam Okoro" })).toBeVisible();
  return samsPage;
};

test.describe("an action from a tab left in another workspace", () => {
  test("refuses a removal, keeping the member in both workspaces", async ({
    page,
    context,
    request,
    passesTheAccessibilityGate,
  }) => {
    const two = await inTwoWorkspaces(page, request, {
      first: "Ouse Castings",
      second: "Foss Castings",
    });
    const removal = removalOf(await atSamsPage(page, request, two));
    const elsewhere = await switchedInAnotherTab(context, page, two);

    const answered = refusalAnswering(page, "members.remove");
    await removal.getByRole("button", { name: MEMBER_PAGE_WORDS.removeMember }).click();
    await removal.getByRole("button", { name: "Remove", exact: true }).click();
    expect(await answered).toMatchObject(SWITCHED);

    await membersReadAfresh(elsewhere, two.second);
    await expect(
      roleOf(elsewhere, "Sam Okoro"),
      `Sam Okoro is no longer a Viewer in ${two.second.name}`,
    ).toHaveText("Viewer");
    await landedHomeSayingWhy(page, two.second);
    await passesTheAccessibilityGate();
    await backIn(elsewhere, two);
    await expect(
      roleOf(elsewhere, "Sam Okoro"),
      `Sam Okoro is no longer an Editor in ${two.first.name}`,
    ).toHaveText("Editor");
  });
});
