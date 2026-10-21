import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { z } from "zod";

import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";
import { CONSOLE, CONTROL_CENTRE, HOMES, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  actionClocked,
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextDraw,
  markTheOperator,
  person,
  provision,
  saysARefusal,
  seedConcepts,
  signedInAtHome,
  signIn,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const PEOPLE = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS = pageNamed(PEOPLE, "Members");

const MODELS = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(MODELS, "Models and Spend");

const SIGNALS = "Signals";

const SIGNALS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), SIGNALS);

const EVERY_WORKSPACE = pageNamed(menuGroupIn(CONSOLE, "workspaces"), "Every Workspace");

const NARROW = { width: 320, height: 720 };

const INVITE_A_PERSON = "Invite a Person";

const PRIYA = "Priya Shah";

const TOM = "Tom Okafor";

const triggerOf = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Jump To" });

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

const refusedIn = (page: Page) => dialogOf(page).getByRole("alert");

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
  const membersReads: string[] = [];
  page.on("request", (sent) => {
    if (theMembersRead(new URL(sent.url()))) membersReads.push(sent.url());
  });

  await opened(page, "Control+k");
  await expect(optionOf(page, /^Ask$/)).toBeVisible();
  await typed(page, "people");

  await expect(saidIn(page)).toContainText("people");
  await expect(dialogOf(page).getByRole("option")).toHaveText(["Search for “people”"]);
  await expect(groupOf(page, "Members")).toHaveCount(0);
  await expect(inputOf(page)).toHaveAttribute("placeholder", /page/i);
  await expect(inputOf(page)).not.toHaveAttribute("placeholder", /member|action/i);
  expect(membersReads, "a Viewer's jump-to asked for the members").toEqual([]);
});

test("opens the invite action on Members for an Admin", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Calder Joinery");

  await opened(page, "Meta+k");
  await typed(page, "invite");
  await expect(optionOf(page, INVITE_A_PERSON)).toBeVisible();
  await page.keyboard.press("Enter");

  const invite = page.getByRole("dialog", { name: INVITE_A_PERSON });
  await expect(invite).toBeVisible();
  await expect(invite.getByLabel("Email Addresses")).toBeFocused();
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}$`));

  await page.keyboard.press("Escape");
  await expect(invite).toHaveCount(0);
  await expect(page.getByRole("button", { name: INVITE_A_PERSON })).toBeFocused();
});

test("opens on either chord anywhere, Escape handing focus back", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Ribble Toolmaking");
  // Left on the window, which hears the key after the jump-to's own listener.
  await page.evaluate(() => {
    window.addEventListener("keydown", (pressed) => {
      if (pressed.key.toLowerCase() === "k") Reflect.set(window, "kept", !pressed.defaultPrevented);
    });
  });
  await expect(triggerOf(page)).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");

  await opened(page, "Meta+k");
  expect(await page.evaluate(() => Reflect.get(window, "kept")), "the browser kept ⌘K").toBe(false);
  await page.keyboard.press("Escape");
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(triggerOf(page)).toBeFocused();

  await page.goto(MEMBERS.path);
  await searchBox(page).focus();
  await opened(page, "Control+k");
  await page.keyboard.press("Escape");
  await expect(triggerOf(page)).toBeFocused();

  await triggerOf(page).click();
  await expect(inputOf(page)).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(triggerOf(page)).toBeFocused();
});

const memberPageNaming = (page: Page, name: string) =>
  page.getByRole("main").getByRole("heading", { level: 2, name, exact: true });

test("lands an Admin on the member they chose", async ({ page, request }) => {
  const team = await anAdminWithATeam(page, request, "Swaledale Ironworks");

  await opened(page, "Meta+k");
  await typed(page, "priya");
  await expect(groupOf(page, "Members")).toBeVisible();
  await optionOf(page, new RegExp(PRIYA)).click();

  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}/${team.priya.id}$`));
  await expect(memberPageNaming(page, PRIYA)).toBeVisible();
  await expect(page.getByRole("main")).toContainText(team.priya.address);
  await expect(memberRows(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();

  await page.goto(MEMBERS.path);
  await page.getByRole("tab", { name: "Invitations" }).click();
  await opened(page, "Meta+k");
  await typed(page, "tom");
  await expect(optionOf(page, new RegExp(TOM))).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}/${team.tom.id}$`));
  await expect(memberPageNaming(page, TOM)).toBeVisible();

  await opened(page, "Meta+k");
  await typed(page, "priya");
  await expect(optionOf(page, new RegExp(PRIYA))).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(memberPageNaming(page, PRIYA)).toBeVisible();
  await expect(memberPageNaming(page, TOM)).toHaveCount(0);
});

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
  z.array(z.string()).parse(await page.evaluate(() => Reflect.get(window, "focusStops")));

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

test("lands on Search with the typed query and its matches", async ({ page, request }) => {
  const email = anAddress("jump-to");
  const workspace = await provision(request, { name: "Lune Valley Records", adminEmail: email });
  await seedConcepts(request, {
    workspaceId: workspace.workspaceId,
    userId: workspace.admin.id,
    concepts: [
      {
        title: "Audit Logs Retention",
        body: "We keep audit logs for seven years, then delete them.",
      },
    ],
  });
  await signedInOffMembers(page, request, email);

  await opened(page, "Meta+k");
  await typed(page, "audit logs");
  await expect(dialogOf(page).getByRole("option")).toHaveText(["Search for “audit logs”"]);
  await page.keyboard.press("Enter");

  await expect(searchBoxOf(page)).toHaveValue("audit logs");
  await expect(
    page
      .getByRole("region", { name: "Search" })
      .getByRole("list", { name: "Matches" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Audit Logs Retention");
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page).toHaveURL(
    new RegExp(`${SEARCH.path}\\?knowledge\\.search=audit(?:\\+|%20)logs$`),
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

test("takes a search written into the address by hand", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);

  await page.goto(`${SEARCH.path}?search=audit`);
  await expect(searchBoxOf(page)).toHaveValue("audit");
  for (const written of ["1.5", "1.50", "1e3"]) {
    await page.goto(`${SEARCH.path}?search=${written}`);
    await expect(searchBoxOf(page)).toHaveValue(written);
  }
  for (const written of ["1.5", "1.50", "1e3", "null"]) {
    await page.goto(`${SEARCH.path}?knowledge.search=${written}`);
    await expect(searchBoxOf(page), "Search's own key re-typed the search").toHaveValue(written);
  }
});

test("reaches the search row by the arrow keys", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);

  await opened(page, "Control+k");
  await typed(page, "search");
  await expect(optionOf(page, /^Search/).first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(searchRowOf(page)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(searchBoxOf(page)).toHaveValue("search");
});

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

test("offers no search row with nothing typed", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);

  await opened(page, "Control+k");
  await expect(optionOf(page, /^Ask$/)).toBeVisible();
  await expect(searchRowOf(page)).toHaveCount(0);

  await typed(page, "audit");
  await expect(searchRowOf(page)).toHaveText(["Search for “audit”"]);
  await typed(page, "");
  await expect(optionOf(page, /^Ask$/)).toBeVisible();
  await expect(searchRowOf(page)).toHaveCount(0);
});

test("offers no search row for spaces alone", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);

  await opened(page, "Control+k");
  await typed(page, "audit");
  await expect(searchRowOf(page)).toHaveCount(1);
  await typed(page, "   ");

  await expect(optionOf(page, /^Ask$/)).toBeVisible();
  await expect(searchRowOf(page)).toHaveCount(0);
  await expect(saidIn(page)).toBeEmpty();
});

test("offers the operator in the console no search row", async ({ page, request }) => {
  const email = anAddress("operator");
  await provision(request, { name: "Lune Valley Pressings", adminEmail: email });
  await markTheOperator(request, email);
  await signedInAtHome(page, request, email);
  await page.goto(EVERY_WORKSPACE.path);
  await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();

  await opened(page, "Meta+k");
  await expect(optionOf(page, "Every Workspace")).toBeVisible();
  await typed(page, "audit logs");

  await expect(saidIn(page)).toContainText("audit logs");
  await expect(dialogOf(page).getByRole("option")).toHaveCount(0);
});

test("finds nothing by an unbuilt page's name", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Nidderdale Forge");

  expect(SIGNALS_PAGE.built, `${SIGNALS} is built, so a reader may find it`).toBe(false);
  await opened(page, "Meta+k");
  await expect(groupOf(page, "Members")).toBeVisible();
  await typed(page, SIGNALS);

  await expect(saidIn(page)).toContainText(SIGNALS);
  await expect(dialogOf(page).getByRole("option")).toHaveText([`Search for “${SIGNALS}”`]);
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

test("keeps pages and actions through a held, then failed, read", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Swale Joinery");
  const held = Promise.withResolvers<void>();
  await page.route(theMembersRead, async (route) => {
    await held.promise;
    await route.abort();
  });

  await opened(page, "Meta+k");
  await typed(page, "invite");
  await expect(optionOf(page, INVITE_A_PERSON)).toBeEnabled();
  await expect(saidIn(page)).toHaveText(/\S/);
  const whileHeld = await saidIn(page).innerText();

  await typed(page, "zzz");
  await expect(dialogOf(page).getByRole("option")).toHaveText(["Search for “zzz”"]);
  await expect(saidIn(page), "the status moved on before the members read ended").toHaveText(
    whileHeld,
  );

  held.resolve();
  await saysARefusal(refusedIn(page), { timeout: 15_000 });
  await expect(saidIn(page), "the status still says the read is held").not.toHaveText(whileHeld);
  await expect(saidIn(page)).toHaveText(/\S/);
  await typed(page, "");
  await expect(optionOf(page, /^Members/)).toBeVisible();
  await expect(optionOf(page, INVITE_A_PERSON)).toBeVisible();
  await expect(groupOf(page, "Members")).toHaveCount(0);
});

test("opens from the narrow band, scrolling nothing sideways", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Wenning Castings");
  await page.setViewportSize(NARROW);

  await triggerOf(page).click();
  await expect(inputOf(page)).toBeFocused();
  await typed(page, "invite");
  await expect(optionOf(page, INVITE_A_PERSON)).toBeVisible();

  const room = await page.evaluate(() => ({
    scrolls: document.documentElement.scrollWidth,
    holds: document.documentElement.clientWidth,
  }));
  expect(room.scrolls, "the page scrolls sideways with jump-to open").toBeLessThanOrEqual(
    room.holds,
  );
  const box = await dialogOf(page).boundingBox();
  expect(box?.x ?? -1, "the dialog starts off the page").toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? NARROW.width + 1)).toBeLessThanOrEqual(NARROW.width);
});
