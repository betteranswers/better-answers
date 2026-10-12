import type { APIRequestContext, BrowserContext, Locator, Page } from "@playwright/test";

import { INVITATIONS_WORDS, STATUS_WORDS } from "@/features/people/invitation-words.ts";
import { BULK_WORDS, SELECTED_MEMBERS } from "@/features/people/member-action-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { saidOfRefusal } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  inTwoWorkspaces,
  invite,
  landedAtHome,
  person,
  saysItsSentenceNotItsWord,
  switched,
  switcherOf,
} from "./harness.ts";

const MEMBERS = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members");

/** What every surface says of an action that named a workspace the session has left. */
const SAID = { "workspace-switched": saidOfRefusal({}, "workspace-switched", "conflict") } as const;

type Role = "Admin" | "Editor" | "Viewer";

type Workspace = { readonly workspaceId: string; readonly name: string };

type Two = { readonly first: Workspace; readonly second: Workspace };

const membersRegion = (page: Page): Locator => page.getByRole("region", { name: "Members" });

/** A row's cells are its tick, the person and then their role. */
const roleOf = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("row").filter({ hasText: name }).getByRole("cell").nth(2);

const tickOf = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("checkbox", { name: `Select ${name}`, exact: true });

const invitationsRegion = (page: Page): Locator =>
  page.getByRole("region", { name: "Invitations" });

const invitationTo = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("row").filter({ hasText: address });

const removalOf = (samsPage: Locator): Locator =>
  samsPage.getByRole("region", { name: "Removal", exact: true });

/** In both, or no action could land on the wrong one; a role apiece tells the two lists apart. */
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

/** `page` takes no fresh document from here on: it would read the member and learn of the switch. */
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
  await expect(switcherOf(page, first.name), "the tab left behind heard of it").toBeVisible();
  return elsewhere;
};

/** A fresh document, so its rows are read from the workspace the session is in now. */
const membersReadAfresh = async (tab: Page, here: Workspace): Promise<void> => {
  await tab.goto(MEMBERS.path);
  await expect(switcherOf(tab, here.name)).toBeVisible();
};

/** The other tab switches back, only once the refused tab has landed: it follows the session. */
const backIn = async (elsewhere: Page, { first, second }: Two): Promise<void> => {
  await switched(elsewhere, second.name, first.name);
  await expect(switcherOf(elsewhere, first.name)).toBeVisible();
  await membersReadAfresh(elsewhere, first);
};

const invitationsOpened = async (tab: Page): Promise<void> => {
  await tab.getByRole("tab", { name: "Invitations" }).click();
  await expect(invitationsRegion(tab).getByRole("heading", { name: "Invitations" })).toBeVisible();
};

const stillWaits = async (tab: Page, address: string, workspace: Workspace): Promise<void> => {
  await expect(
    invitationsRegion(tab).getByRole("radio", { name: new RegExp(`^${STATUS_WORDS.waiting}\\b`) }),
    `${workspace.name} no longer holds its one waiting invitation`,
  ).toHaveAccessibleName(`${STATUS_WORDS.waiting} 1`);
  await expect(invitationTo(tab, address)).toBeVisible();
};

/** Awaited before either workspace is read, so what the action left is read after it landed. */
const answerTo = (page: Page, procedure: string) =>
  page.waitForResponse((answer) => answer.url().includes(procedure));

const landedHomeSayingWhy = async (page: Page, now: Workspace): Promise<void> => {
  await saysItsSentenceNotItsWord(page.getByRole("banner").getByRole("alert"), {
    table: SAID,
    word: "workspace-switched",
  });
  await landedAtHome(page, "Admin");
  await expect(switcherOf(page, now.name), "the band names the workspace left").toBeVisible();
};

/** Sam's page under `first`, read before the other tab switches. */
const atSamsPage = async (page: Page, api: APIRequestContext, two: Two): Promise<Locator> => {
  const sam = await aMemberOfBoth(api, two, "Sam Okoro", { first: "Editor", second: "Viewer" });
  await page.goto(`${MEMBERS.path}/${sam}`);
  const samsPage = page.getByRole("main");
  await expect(samsPage.getByRole("heading", { level: 2, name: "Sam Okoro" })).toBeVisible();
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

    const answered = answerTo(page, "members.remove");
    await removal.getByRole("button", { name: "Remove Sam Okoro", exact: true }).click();
    await removal.getByRole("button", { name: "Remove Sam Okoro from this workspace" }).click();
    await answered;

    await membersReadAfresh(elsewhere, two.second);
    await expect(roleOf(elsewhere, "Sam Okoro"), `removed from ${two.second.name}`).toHaveText(
      "Viewer",
    );
    await landedHomeSayingWhy(page, two.second);
    await passesTheAccessibilityGate();
    await backIn(elsewhere, two);
    await expect(roleOf(elsewhere, "Sam Okoro"), `removed from ${two.first.name}`).toHaveText(
      "Editor",
    );
  });

  test("refuses a ticked set's role change, every role kept", async ({
    page,
    context,
    request,
  }) => {
    const two = await inTwoWorkspaces(page, request, {
      first: "Ouse Joinery",
      second: "Foss Joinery",
    });
    const ticked = ["Sam Okoro", "Priya Shah"];
    for (const name of ticked) {
      await aMemberOfBoth(request, two, name, { first: "Editor", second: "Admin" });
    }
    await membersReadAfresh(page, two.first);
    await expect(roleOf(page, "Priya Shah")).toHaveText("Editor");
    const elsewhere = await switchedInAnotherTab(context, page, two);

    for (const name of ticked) await tickOf(page, name).check();
    await page
      .getByRole("toolbar", { name: SELECTED_MEMBERS })
      .getByRole("button", { name: BULK_WORDS.changeRole.action, exact: true })
      .click();
    const answered = answerTo(page, "members.bulkChangeRole");
    await page
      .getByRole("dialog", { name: BULK_WORDS.changeRole.title(2) })
      .getByRole("button", { name: BULK_WORDS.changeRole.commit(2, "Viewer") })
      .click();
    await answered;

    await membersReadAfresh(elsewhere, two.second);
    for (const name of ticked) {
      await expect(roleOf(elsewhere, name), `changed in ${two.second.name}`).toHaveText("Admin");
    }
    await landedHomeSayingWhy(page, two.second);
    await backIn(elsewhere, two);
    for (const name of ticked) {
      await expect(roleOf(elsewhere, name), `changed in ${two.first.name}`).toHaveText("Editor");
    }
  });

  test("refuses cancelling an invitation read since the switch", async ({
    page,
    context,
    request,
  }) => {
    const two = await inTwoWorkspaces(page, request, {
      first: "Ouse Ropery",
      second: "Foss Ropery",
    });
    const [kept, read] = [anAddress("ouse"), anAddress("foss")];
    for (const [workspace, email] of [
      [two.first, kept],
      [two.second, read],
    ] as const) {
      await invite(request, {
        workspaceId: workspace.workspaceId,
        email,
        inviterId: two.first.admin.id,
        role: "Viewer",
      });
    }
    await membersReadAfresh(page, two.first);
    const elsewhere = await switchedInAnotherTab(context, page, two);

    await invitationsOpened(page);
    await expect(invitationTo(page, read), "the rows are not the session's").toBeVisible();
    await expect(switcherOf(page, two.first.name), "the band no longer names it").toBeVisible();
    const answered = answerTo(page, "members.cancelInvitation");
    await invitationsRegion(page)
      .getByRole("button", { name: `Actions for ${read}` })
      .click();
    await page.getByRole("menuitem", { name: INVITATIONS_WORDS.cancel }).click();
    await answered;

    await membersReadAfresh(elsewhere, two.second);
    await invitationsOpened(elsewhere);
    await stillWaits(elsewhere, read, two.second);
    await landedHomeSayingWhy(page, two.second);
    await backIn(elsewhere, two);
    await invitationsOpened(elsewhere);
    await stillWaits(elsewhere, kept, two.first);
  });

  test("asks once when a role change is pressed twice", async ({ page, context, request }) => {
    const two = await inTwoWorkspaces(page, request, {
      first: "Ouse Gilding",
      second: "Foss Gilding",
    });
    const samsPage = await atSamsPage(page, request, two);
    const elsewhere = await switchedInAnotherTab(context, page, two);
    await samsPage.getByRole("radio", { name: "Admin", exact: true }).click();

    // Answered by the api and held on its way back, so the second press meets the first pending.
    const held = Promise.withResolvers<void>();
    let asked = 0;
    await page.route(
      (url) => url.pathname.includes("members.changeRole"),
      async (route) => {
        asked += 1;
        const response = await route.fetch();
        await held.promise;
        await route.fulfill({ response });
      },
    );
    // By pointer: the first press hands focus to the picked role, so a key's second would miss.
    await samsPage.getByRole("button", { name: "Make Sam Okoro an Admin" }).dblclick();
    await expect.poll(() => asked, { message: "neither press asked the api" }).toBe(1);
    held.resolve();

    await landedHomeSayingWhy(page, two.second);
    expect(asked, "the second press asked the api again").toBe(1);
    await membersReadAfresh(elsewhere, two.second);
    await expect(roleOf(elsewhere, "Sam Okoro"), `changed in ${two.second.name}`).toHaveText(
      "Viewer",
    );
    await backIn(elsewhere, two);
    await expect(roleOf(elsewhere, "Sam Okoro"), `changed in ${two.first.name}`).toHaveText(
      "Editor",
    );
  });
});
