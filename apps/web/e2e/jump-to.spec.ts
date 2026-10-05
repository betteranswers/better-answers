import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { JUMP_TO, nothingMatches } from "@/app/words.ts";
import {
  ASK,
  CONTROL_CENTRE,
  menuGroupIn,
  headingOf,
  INVITE_A_PERSON,
  pageNamed,
} from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextKey,
  person,
  provision,
  signIn,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const PEOPLE = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS = pageNamed(PEOPLE, "Members");

const MODELS = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(MODELS, "Models and spend");

/** Declared and never built, so no reader may find it. */
const SIGNALS = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), "Signals");

const NARROW = { width: 320, height: 720 };

const PRIYA = "Priya Shah";

const TOM = "Tom Okafor";

const triggerOf = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: JUMP_TO.name });

const dialogOf = (page: Page) => page.getByRole("dialog", { name: JUMP_TO.name });

const inputOf = (page: Page) => dialogOf(page).getByRole("combobox", { name: JUMP_TO.name });

const optionOf = (page: Page, name: string | RegExp) =>
  dialogOf(page).getByRole("option", { name });

const groupOf = (page: Page, name: string) => dialogOf(page).getByRole("group", { name });

const saidIn = (page: Page) => dialogOf(page).getByRole("status");

const refusedIn = (page: Page) => dialogOf(page).getByRole("alert");

const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search by name or address" });

const membersRegion = (page: Page) => page.getByRole("region", { name: "Members" });

/** The header row is a row too, so the members are the rows with a cell. */
const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

/** Matched by name anywhere in the path, because the client batches its reads. */
const theMembersRead = (url: URL) => url.pathname.includes("members.list");

type Teammate = { readonly address: string; readonly id: string };

type Team = { readonly priya: Teammate; readonly tom: Teammate };

/** An Admin of a workspace with two other members, on a page that reads none of them. */
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
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.goto(MODELS_AND_SPEND.path);
  await expect(
    page.getByRole("heading", { level: 1, name: headingOf(MODELS_AND_SPEND) }),
  ).toBeVisible();
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
  await aMemberSignedInAt(page, request, "Viewer", ASK.home.path);
  const membersReads: string[] = [];
  page.on("request", (sent) => {
    if (theMembersRead(new URL(sent.url()))) membersReads.push(sent.url());
  });

  await opened(page, "Control+k");
  await expect(optionOf(page, ASK.name)).toBeVisible();
  await typed(page, "people");

  await expect(saidIn(page)).toHaveText(nothingMatches("people"));
  await expect(dialogOf(page).getByRole("option")).toHaveCount(0);
  await expect(groupOf(page, JUMP_TO.groups.members)).toHaveCount(0);
  await expect(inputOf(page)).toHaveAttribute("placeholder", /^Find a page$/);
  expect(membersReads, "a Viewer's jump-to asked for the members").toEqual([]);
});

test("opens the invite act on Members for an Admin", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Calder Joinery");

  await opened(page, "Meta+k");
  await typed(page, "invite");
  await expect(optionOf(page, INVITE_A_PERSON.name)).toBeVisible();
  await page.keyboard.press("Enter");

  const invite = page.getByRole("dialog", { name: INVITE_A_PERSON.name });
  await expect(invite).toBeVisible();
  await expect(invite.getByLabel("Email address")).toBeFocused();
  await expect(dialogOf(page)).toHaveCount(0);
  // The act takes its ask off the address, so a reload or a step back does not reopen it.
  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}$`));

  await page.keyboard.press("Escape");
  await expect(invite).toHaveCount(0);
  await expect(page.getByRole("button", { name: INVITE_A_PERSON.name })).toBeFocused();
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

  // From inside a field on another page: the chord is never the field's.
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

/** A member's page, told by the person its heading names. */
const memberPageNaming = (page: Page, name: string) =>
  page.getByRole("main").getByRole("heading", { level: 2, name, exact: true });

test("lands an Admin on the member they chose", async ({ page, request }) => {
  const team = await anAdminWithATeam(page, request, "Swaledale Ironworks");

  await opened(page, "Meta+k");
  await typed(page, "priya");
  await expect(groupOf(page, JUMP_TO.groups.members)).toBeVisible();
  await optionOf(page, new RegExp(PRIYA)).click();

  // The person's own page, not a list narrowed to them.
  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}/${team.priya.id}$`));
  await expect(memberPageNaming(page, PRIYA)).toBeVisible();
  await expect(page.getByRole("main")).toContainText(team.priya.address);
  await expect(memberRows(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();

  // From another tab of Members, the next one chosen opens their page as well.
  await page.goto(MEMBERS.path);
  await page.getByRole("tab", { name: "Invitations" }).click();
  await opened(page, "Meta+k");
  await typed(page, "tom");
  await expect(optionOf(page, new RegExp(TOM))).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}/${team.tom.id}$`));
  await expect(memberPageNaming(page, TOM)).toBeVisible();

  // From one member's page to another's, so the page names the person it now holds.
  await opened(page, "Meta+k");
  await typed(page, "priya");
  await expect(optionOf(page, new RegExp(PRIYA))).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(memberPageNaming(page, PRIYA)).toBeVisible();
  await expect(memberPageNaming(page, TOM)).toHaveCount(0);
});

test("finds nothing by an unbuilt page's name", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Nidderdale Forge");

  await opened(page, "Meta+k");
  await expect(groupOf(page, JUMP_TO.groups.members)).toBeVisible();
  await typed(page, SIGNALS.name);

  await expect(saidIn(page)).toHaveText(nothingMatches(SIGNALS.name));
  await expect(dialogOf(page).getByRole("option")).toHaveCount(0);
});

test("draws the list within its second, timed in the page", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Ryedale Metalwork");
  // A fresh document, so no members read is cached to answer it.
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: headingOf(MODELS_AND_SPEND) }),
  ).toBeVisible();

  await clockTheNextKey(page, { at: "//*[@role='dialog']", reads: TOM });
  await page.keyboard.press("Meta+k");
  const elapsed = await page.evaluate(() => Reflect.get(window, "actClocked"));
  test.info().annotations.push({ type: "jump-to list", description: `${elapsed} ms` });
  expect(elapsed, "the jump-to list did not draw within its second").toBeLessThan(LIST_BUDGET_MS);

  await expect(groupOf(page, JUMP_TO.groups.pages)).toBeVisible();
  await expect(optionOf(page, new RegExp(PRIYA))).toBeVisible();
  await expect(optionOf(page, INVITE_A_PERSON.name)).toBeVisible();
});

test("keeps pages and acts through a held, then failed, read", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Swale Joinery");
  const held = Promise.withResolvers<void>();
  await page.route(theMembersRead, async (route) => {
    await held.promise;
    await route.abort();
  });

  await opened(page, "Meta+k");
  await typed(page, "invite");
  await expect(optionOf(page, INVITE_A_PERSON.name)).toBeEnabled();
  await expect(saidIn(page)).toHaveText(JUMP_TO.membersLoading);

  await typed(page, "zzz");
  await expect(dialogOf(page).getByRole("option")).toHaveCount(0);
  await expect(saidIn(page)).toHaveText(JUMP_TO.membersLoading);

  held.resolve();
  // The query client asks again twice before it gives up.
  await expect(refusedIn(page)).toHaveText(JUMP_TO.membersUnread, { timeout: 15_000 });
  await expect(saidIn(page)).toHaveText(nothingMatches("zzz"));
  await typed(page, "");
  await expect(optionOf(page, new RegExp(`^${MEMBERS.name}`))).toBeVisible();
  await expect(optionOf(page, INVITE_A_PERSON.name)).toBeVisible();
  await expect(groupOf(page, JUMP_TO.groups.members)).toHaveCount(0);
});

test("opens from the narrow band, scrolling nothing sideways", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Wenning Castings");
  await page.setViewportSize(NARROW);

  await triggerOf(page).click();
  await expect(inputOf(page)).toBeFocused();
  await typed(page, "invite");
  await expect(optionOf(page, INVITE_A_PERSON.name)).toBeVisible();

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
