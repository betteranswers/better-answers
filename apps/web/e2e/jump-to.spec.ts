import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { JUMP_TO, nothingMatches, searchFor } from "@/app/words.ts";
import { SEARCH_WORDS } from "@/features/knowledge/knowledge-words.ts";
import {
  ASK,
  CONSOLE,
  CONTROL_CENTRE,
  KNOWLEDGE,
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
  markTheOperator,
  person,
  provision,
  seedConcepts,
  signedInAtHome,
  signIn,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const PEOPLE = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS = pageNamed(PEOPLE, "Members");

const MODELS = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(MODELS, "Models and spend");

/** Declared and never built, so no reader may find it. */
const SIGNALS = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), "Signals");

const SEARCH = pageNamed(menuGroupIn(KNOWLEDGE, "browse"), "Search");

const EVERY_WORKSPACE = pageNamed(menuGroupIn(CONSOLE, "workspaces"), "Every workspace");

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

/** The row that takes what is typed to Search, listed under its area's name. */
const searchRowOf = (page: Page) => groupOf(page, KNOWLEDGE.name).getByRole("option");

const searchBoxOf = (page: Page) =>
  page
    .getByRole("region", { name: SEARCH.name })
    .getByRole("searchbox", { name: SEARCH_WORDS.search });

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

/** Matched by name anywhere in the path, because the tRPC client batches its reads. */
const theMembersRead = (url: URL) => url.pathname.includes("members.list");

/** Signed in on a page that reads no members, so jump-to's own read is the first. */
const signedInOffMembers = async (page: Page, api: APIRequestContext, email: string) => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.goto(MODELS_AND_SPEND.path);
  await expect(
    page.getByRole("heading", { level: 1, name: headingOf(MODELS_AND_SPEND) }),
  ).toBeVisible();
};

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
  await aMemberSignedInAt(page, request, "Viewer", ASK.home.path);
  const membersReads: string[] = [];
  page.on("request", (sent) => {
    if (theMembersRead(new URL(sent.url()))) membersReads.push(sent.url());
  });

  await opened(page, "Control+k");
  await expect(optionOf(page, ASK.name)).toBeVisible();
  await typed(page, "people");

  await expect(saidIn(page)).toHaveText(nothingMatches("people"));
  // Search's row is no match, so it stands beside the line that says nothing matches.
  await expect(dialogOf(page).getByRole("option")).toHaveText([searchFor("people")]);
  await expect(groupOf(page, JUMP_TO.groups.members)).toHaveCount(0);
  await expect(inputOf(page)).toHaveAttribute("placeholder", /^Find a page$/);
  expect(membersReads, "a Viewer's jump-to asked for the members").toEqual([]);
});

test("opens the invite action on Members for an Admin", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Calder Joinery");

  await opened(page, "Meta+k");
  await typed(page, "invite");
  await expect(optionOf(page, INVITE_A_PERSON.name)).toBeVisible();
  await page.keyboard.press("Enter");

  const invite = page.getByRole("dialog", { name: INVITE_A_PERSON.name });
  await expect(invite).toBeVisible();
  await expect(invite.getByLabel("Email address")).toBeFocused();
  await expect(dialogOf(page)).toHaveCount(0);
  // The action takes its ask off the address, so a reload or a step back does not reopen it.
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
  await expect(dialogOf(page).getByRole("option")).toHaveText([searchFor("audit logs")]);
  await page.keyboard.press("Enter");

  await expect(searchBoxOf(page)).toHaveValue("audit logs");
  await expect(
    page
      .getByRole("region", { name: SEARCH.name })
      .getByRole("list", { name: SEARCH_WORDS.matches })
      .getByRole("listitem")
      .first(),
  ).toContainText("Audit Logs Retention");
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
  // Search takes the ask off the address and keeps the query under its own key.
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
    await aMemberSignedInAt(page, request, "Viewer", ASK.home.path);

    await opened(page, "Control+k");
    await typed(page, words);
    await searchRowOf(page).click();

    await expect(searchBoxOf(page)).toHaveValue(words);
    // Search's own key holds it too, once the box has settled.
    await expect(page).toHaveURL(/knowledge\.search=/);
    await page.reload();
    await expect(searchBoxOf(page)).toHaveValue(words);
  });
}

test("takes a search written into the address by hand", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", ASK.home.path);

  await page.goto(`${SEARCH.path}?search=audit`);
  await expect(searchBoxOf(page)).toHaveValue("audit");
  await page.goto(`${SEARCH.path}?search=1.5`);
  await expect(searchBoxOf(page)).toHaveValue("1.5");
});

test("reaches the search row by the arrow keys", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", ASK.home.path);

  await opened(page, "Control+k");
  await typed(page, "search");
  await expect(optionOf(page, new RegExp(`^${SEARCH.name}`)).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // The list loops, so one step up from the first match is the last row.
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
  await aMemberSignedInAt(page, request, "Viewer", ASK.home.path);

  await opened(page, "Control+k");
  await expect(optionOf(page, ASK.name)).toBeVisible();
  await expect(searchRowOf(page)).toHaveCount(0);

  await typed(page, "audit");
  await expect(searchRowOf(page)).toHaveText([searchFor("audit")]);
  await typed(page, "");
  await expect(optionOf(page, ASK.name)).toBeVisible();
  await expect(searchRowOf(page)).toHaveCount(0);
});

test("offers no search row for spaces alone", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", ASK.home.path);

  await opened(page, "Control+k");
  await typed(page, "audit");
  await expect(searchRowOf(page)).toHaveCount(1);
  await typed(page, "   ");

  await expect(optionOf(page, ASK.name)).toBeVisible();
  await expect(searchRowOf(page)).toHaveCount(0);
  await expect(saidIn(page)).toBeEmpty();
});

test("offers the operator in the console no search row", async ({ page, request }) => {
  const email = anAddress("operator");
  await provision(request, { name: "Lune Valley Pressings", adminEmail: email });
  await markTheOperator(request, email);
  await signedInAtHome(page, request, email);
  await page.goto(EVERY_WORKSPACE.path);
  await expect(
    page.getByRole("heading", { level: 1, name: headingOf(EVERY_WORKSPACE) }),
  ).toBeVisible();

  await opened(page, "Meta+k");
  await expect(optionOf(page, EVERY_WORKSPACE.name)).toBeVisible();
  await typed(page, "audit logs");

  await expect(saidIn(page)).toHaveText(nothingMatches("audit logs"));
  await expect(dialogOf(page).getByRole("option")).toHaveCount(0);
});

test("finds nothing by an unbuilt page's name", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Nidderdale Forge");

  await opened(page, "Meta+k");
  await expect(groupOf(page, JUMP_TO.groups.members)).toBeVisible();
  await typed(page, SIGNALS.name);

  await expect(saidIn(page)).toHaveText(nothingMatches(SIGNALS.name));
  await expect(dialogOf(page).getByRole("option")).toHaveText([searchFor(SIGNALS.name)]);
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
  const elapsed = await page.evaluate(() => Reflect.get(window, "actionClocked"));
  test.info().annotations.push({ type: "jump-to list", description: `${elapsed} ms` });
  expect(elapsed, "the jump-to list did not draw within its second").toBeLessThan(LIST_BUDGET_MS);

  await expect(groupOf(page, JUMP_TO.groups.pages)).toBeVisible();
  await expect(optionOf(page, new RegExp(PRIYA))).toBeVisible();
  await expect(optionOf(page, INVITE_A_PERSON.name)).toBeVisible();
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
  await expect(optionOf(page, INVITE_A_PERSON.name)).toBeEnabled();
  await expect(saidIn(page)).toHaveText(JUMP_TO.membersLoading);

  await typed(page, "zzz");
  await expect(dialogOf(page).getByRole("option")).toHaveText([searchFor("zzz")]);
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
