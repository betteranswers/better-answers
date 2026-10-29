import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { z } from "zod";

import { CONTROL_CENTRE, HOMES, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  actionClocked,
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextDraw,
  person,
  provision,
  signIn,
  requestsSent,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const PEOPLE = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS = pageNamed(PEOPLE, "Members");

const MODELS = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(MODELS, "Models and Spend");

const INVITE_A_PERSON = "Invite a Person";

const PRIYA = "Priya Shah";

const TOM = "Tom Okafor";

const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Jump To" });

const inputOf = (page: Page) => dialogOf(page).getByRole("combobox", { name: "Jump To" });

const optionOf = (page: Page, name: string | RegExp) =>
  dialogOf(page).getByRole("option", { name });

const groupOf = (page: Page, name: string) => dialogOf(page).getByRole("group", { name });

const searchRowOf = (page: Page) => groupOf(page, "Knowledge").getByRole("option");

const searchBoxOf = (page: Page) =>
  page
    .getByRole("region", { name: "Search" })
    .getByRole("searchbox", { name: "Search by a word or a question" });

const saidIn = (page: Page) => dialogOf(page).getByRole("status");

const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search by name or address" });

const membersRegion = (page: Page) => page.getByRole("region", { name: "Members" });

const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

/** Matched by name anywhere in the path, because the tRPC client batches its reads. */
const theMembersRead = (url: URL) => url.pathname.includes("members.list");

const signedInOffMembers = async (page: Page, api: APIRequestContext, email: string) => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.goto(MODELS_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: "Models" })).toBeVisible();
};

type Teammate = { readonly address: string; readonly id: string };

type Team = { readonly priya: Teammate; readonly tom: Teammate };

const anAdminWithATeam = async (page: Page, api: APIRequestContext, name: string) => {
  const email = anAddress("jump-to");
  const workspace = await provision(api, { name, adminEmail: email });
  const joined: Teammate[] = [];
  for (const [address, displayName, role] of [
    [anAddress("priya"), PRIYA, "Editor"],
    [anAddress("tom"), TOM, "Viewer"],
  ] as const) {
    const member = await person(api, address, { displayName });
    await addMember(api, { workspaceId: workspace.workspaceId, userId: member.id, role });
    joined.push({ address, id: member.id });
  }
  const [priya, tom] = joined;
  if (priya === undefined || tom === undefined) throw new Error("the team was joined");
  const team: Team = { priya, tom };
  await signedInOffMembers(page, api, email);
  return team;
};

const opened = async (page: Page, keys: string) => {
  await page.keyboard.press(keys);
  await expect(dialogOf(page)).toBeVisible();
  await expect(inputOf(page)).toBeFocused();
};

const typed = async (page: Page, words: string) => {
  await inputOf(page).fill(words);
};

test("hides People from a Viewer, reading no members", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);
  const membersReads = requestsSent(page, theMembersRead);

  await opened(page, "Control+k");
  await expect(optionOf(page, /^Ask$/)).toBeVisible();
  await typed(page, "people");

  await expect(saidIn(page)).toContainText("people");
  await expect(dialogOf(page).getByRole("option")).toHaveText(["Search for “people”"]);
  await expect(groupOf(page, "Members")).toHaveCount(0);
  await expect(inputOf(page)).toHaveAttribute("placeholder", /page/i);
  await expect(inputOf(page)).not.toHaveAttribute("placeholder", /member|action/i);
  expect(
    membersReads.map((sent) => sent.url()),
    "a Viewer's jump-to asked for the members",
  ).toEqual([]);
});

const memberPageNaming = (page: Page, name: string) =>
  page.getByRole("main").getByRole("heading", { level: 2, name, exact: true });

const jumpedToMember = async (page: Page, words: string, name: string): Promise<void> => {
  await opened(page, "Meta+k");
  await typed(page, words);
  await optionOf(page, new RegExp(name)).click();
  await expect(memberPageNaming(page, name)).toBeVisible();
};

const removedOnTheirPage = async (page: Page): Promise<void> => {
  const removal = page.getByRole("region", { name: "Removal", exact: true });
  await removal.getByRole("button", { name: "Remove Member" }).click();
  await removal.getByRole("button", { name: "Remove", exact: true }).click();
};

test("removing a member opened from jump-to keeps Members' search", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Swaledale Lead Mines");
  await page.goto(MEMBERS.path);
  await searchBox(page).fill("Okafor");
  await expect(page).toHaveURL(/members\.search=Okafor$/);
  await expect(memberRows(page)).toHaveCount(1);

  await jumpedToMember(page, "priya", PRIYA);
  await removedOnTheirPage(page);

  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}\\?members\\.search=Okafor$`));
  await expect(searchBox(page)).toHaveValue("Okafor");
  await expect(memberRows(page)).toHaveCount(1);
  await expect(memberRows(page)).toContainText(TOM);
});

const focusStopsRecorded = (page: Page) =>
  page.evaluate(() => {
    const stops: string[] = [];
    Reflect.set(window, "focusStops", stops);
    document.addEventListener("focusin", (event) => {
      if (event.target instanceof HTMLElement) stops.push(event.target.innerText);
    });
  });

const focusStops = async (page: Page): Promise<readonly string[]> =>
  z.array(z.string()).parse(await page.evaluate((): unknown => Reflect.get(window, "focusStops")));

test("jumping after a removal focuses the page, not Remove", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Swaledale Smelters");
  await page.goto(MEMBERS.path);
  await membersRegion(page)
    .getByRole("button", { name: `Actions for ${PRIYA}` })
    .click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await removedOnTheirPage(page);
  await expect(memberRows(page)).toHaveCount(2);

  await focusStopsRecorded(page);
  await jumpedToMember(page, "tom", TOM);
  await expect(page.getByRole("main")).toBeFocused();
  expect(await focusStops(page), "focus never stops on Remove Member").not.toContain(
    "Remove Member",
  );
});

for (const [what, words] of [
  ["a decimal", "1.50"],
  ["an exponent", "1e3"],
  ["a quoted phrase", '"audit logs"'],
] as const) {
  test(`carries ${what} from jump-to to Search as typed`, async ({ page, request }) => {
    await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);

    await opened(page, "Control+k");
    await typed(page, words);
    await searchRowOf(page).click();

    await expect(searchBoxOf(page)).toHaveValue(words);
    await expect(page).toHaveURL(/knowledge\.search=/);
    await page.reload();
    await expect(searchBoxOf(page)).toHaveValue(words);
  });
}

test("opens a member who loads after the search row", async ({ page, request }) => {
  const team = await anAdminWithATeam(page, request, "Hodder Valley Forge");
  const held = Promise.withResolvers<void>();
  await page.route(theMembersRead, async (route) => {
    await held.promise;
    await route.continue();
  });

  await opened(page, "Meta+k");
  await typed(page, "priya");
  await expect(searchRowOf(page)).toHaveAttribute("aria-selected", "true");
  held.resolve();
  await expect(optionOf(page, new RegExp(PRIYA))).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}/${team.priya.id}$`));
});

test("draws the list within its second, timed in the page", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Ryedale Metalwork");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Models" })).toBeVisible();

  await clockTheNextDraw(page, { at: "//*[@role='dialog']", reads: TOM });
  await page.keyboard.press("Meta+k");
  const elapsed = await actionClocked(page);
  test.info().annotations.push({ type: "jump-to list", description: `${elapsed} ms` });
  expect(elapsed, "the jump-to list did not draw within its second").toBeLessThan(LIST_BUDGET_MS);

  await expect(groupOf(page, "Pages")).toBeVisible();
  await expect(optionOf(page, new RegExp(PRIYA))).toBeVisible();
  await expect(optionOf(page, INVITE_A_PERSON)).toBeVisible();
});
