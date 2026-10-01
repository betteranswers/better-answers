import type { Locator, Page } from "@playwright/test";

import { BREADCRUMB, JUMP_TO, NAVIGATION_SHEET, RAIL, TOGGLE } from "@/app/words.ts";
import { ROUTES_WORDS } from "@/features/routes/words.ts";
import { keystrokesOn } from "@/shared/keystroke-words.ts";
import {
  ASK,
  CONTROL_CENTRE,
  groupIn,
  headingOf,
  HOMES,
  readerOf,
  screenNamed,
  screensOf,
  SURFACES,
  visibleTo,
} from "@/shared/navigation.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  anAddress,
  avatarOf,
  crumbOf,
  invite,
  keystrokesButton,
  keystrokesDismissed,
  keystrokesListed,
  navOf,
  person,
  personMenuOpened,
  provision,
  railOf,
  signIn,
  skipLinkReachesTheScreen,
  switcherOf,
  tabUntilFocused,
} from "./harness.ts";

/** What an Admin is shown today, read off the list: Control Centre and its built screens. */
const AN_ADMINS = visibleTo(readerOf("Admin"), SURFACES).surfaces;

const SURFACE_NAMES = AN_ADMINS.map((surface) => surface.name);

const SCREEN_NAMES = screensOf(AN_ADMINS).map((each) => each.name);

const AGENT_OPERATIONS = groupIn(CONTROL_CENTRE, "agent-operations");

const ROUTES_AND_SPEND = screenNamed(AGENT_OPERATIONS, "Routes and spend");

const PEOPLE = groupIn(CONTROL_CENTRE, "people");

const MEMBERS = screenNamed(PEOPLE, "Members");

/** The first heading Routes and spend draws: its group's name. */
const ITS_HEADING = headingOf(ROUTES_AND_SPEND);

const SWAP_BUDGET_MS = 1000;

const ACT_BUDGET_MS = 100;

const NARROW = { width: 320, height: 720 };

/** Short enough that the band scrolls out of sight within one screen's content. */
const NARROW_AND_SHORT = { width: 320, height: 256 };

/** Past `--breakpoint-md`, which `--shell-wide` in `index.css` reads for the shell. */
const WIDE = { width: 1024, height: 720 };

const DESKTOP = { width: 1440, height: 900 };

const LONG_NAME = "Wharfedale and Nidderdale Precision Castings and Pattern Co.";

const LONG_PERSON = "Bartholomew Featherstonehaugh-Whittingham";

const bandOf = (page: Page) => page.getByRole("banner");

const logoOf = (page: Page) => bandOf(page).getByRole("link", { name: PRODUCT_NAME });

const closerOf = (page: Page) => page.getByRole("button", { name: TOGGLE.hide });

const openerOf = (page: Page) => page.getByRole("button", { name: TOGGLE.show });

const sheetButtonOf = (page: Page) => page.getByRole("button", { name: NAVIGATION_SHEET });

const sheetOf = (page: Page) => page.getByRole("dialog", { name: NAVIGATION_SHEET });

const jumpToOf = (page: Page) => bandOf(page).getByRole("button", { name: JUMP_TO.name });

const partOf = (page: Page, name: string) => bandOf(page).getByText(name, { exact: true });

const crumbsOf = (page: Page) => bandOf(page).getByRole("navigation", { name: BREADCRUMB });

const TOOLBAR_TABS = ["Routes", "Spend"];

const tabsOf = (page: Page) => page.getByRole("tablist", { name: "Routes and spend" });

const routesCardOf = (page: Page) => page.getByRole("region", { name: "Routes" });

/**
 * The screen reads the routes after the nav paints, so a screen here has started only once its
 * card says a new workspace has none.
 */
const theRoutesHaveLanded = (page: Page) =>
  expect(routesCardOf(page).getByText(ROUTES_WORDS.noneSet, { exact: true })).toBeVisible();

const boxOf = async (region: Locator) => {
  const box = await region.boundingBox();
  if (box === null) throw new Error("the region is not drawn");
  return box;
};

const topOf = async (region: Locator): Promise<number> => (await boxOf(region)).y;

const widthOf = async (region: Locator): Promise<number> => (await boxOf(region)).width;

const leftOf = async (region: Locator): Promise<number> => (await boxOf(region)).x;

const sidewaysRoom = (page: Page) =>
  page.evaluate(() => ({
    scrolls: document.documentElement.scrollWidth,
    holds: document.documentElement.clientWidth,
  }));

const scrollsNothingSideways = async (page: Page, when: string) => {
  const room = await sidewaysRoom(page);
  expect(room.scrolls, `the page scrolls sideways ${when}`).toBeLessThanOrEqual(room.holds);
};

const holdsFocus = (panel: Locator) =>
  panel.evaluate((node) => node.contains(document.activeElement));

/** How a band fixed in place can cover what has focus: over its middle, or anywhere in its box. */
const focusAgainstTheBand = (page: Page) =>
  page.evaluate(() => {
    const crosses = (one: DOMRect, other: DOMRect) =>
      one.left < other.right &&
      other.left < one.right &&
      one.top < other.bottom &&
      other.top < one.bottom;

    const band = document.querySelector("header");
    const focused = document.activeElement;
    if (band === null || focused === null || band.contains(focused)) {
      return { under: false, overlaps: false };
    }
    const box = focused.getBoundingClientRect();
    const drawn = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      under: drawn !== null && band.contains(drawn),
      overlaps: crosses(box, band.getBoundingClientRect()),
    };
  });

const focusUnderTheBand = async (page: Page) => (await focusAgainstTheBand(page)).under;

const overlapsTheBand = async (page: Page) => (await focusAgainstTheBand(page)).overlaps;

/** Tab by tab to `target`, no stop on the way sharing the band's box. */
const tabClearOfTheBand = async (page: Page, target: Locator, most = 40) => {
  for (let pressed = 0; pressed < most; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
    expect(await overlapsTheBand(page), `a stop before ${String(target)} overlaps the band`).toBe(
      false,
    );
  }
  await expect(target, "Tab never reached it").toBeFocused();
};

const inDocumentOrder = async (page: Page, regions: readonly Locator[]): Promise<boolean> => {
  const nodes = await Promise.all(regions.map((region) => region.elementHandle()));
  return page.evaluate(
    (drawn) =>
      drawn.every(
        (node, at) =>
          at === 0 ||
          ((drawn[at - 1]?.compareDocumentPosition(node) ?? 0) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
      ),
    nodes,
  );
};

/** Swept rather than read by key: what matters is that nothing kept here is about the reader. */
const keptOnThisBrowser = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage).map((key) => `${key} ${localStorage.getItem(key) ?? ""}`),
  );

const paintedFill = (page: Page, name: string) =>
  railOf(page)
    .getByRole("link", { name })
    .evaluate((link) => getComputedStyle(link).backgroundColor);

const weightOf = (page: Page, screenName: string) =>
  navOf(page, CONTROL_CENTRE)
    .getByRole("link", { name: screenName })
    .evaluate((link) => Number.parseInt(getComputedStyle(link).fontWeight, 10));

const glyphOf = (page: Page, screenName: string) =>
  navOf(page, CONTROL_CENTRE)
    .getByRole("link", { name: screenName })
    .evaluate((link) => link.querySelector("svg")?.innerHTML ?? "");

/** A colour as a greyscale screen shows it, so a mark that is hue alone reads as no mark. */
const greyOf = (region: Locator, painted: "own" | "behind") =>
  region.evaluate((node, which) => {
    let from: Element | null = which === "own" ? node : node.parentElement;
    while (from !== null && getComputedStyle(from).backgroundColor === "rgba(0, 0, 0, 0)") {
      from = from.parentElement;
    }
    const [red = 0, green = 0, blue = 0] = (
      from === null ? "0,0,0" : getComputedStyle(from).backgroundColor
    )
      .replaceAll(/[^\d,.]/g, "")
      .split(",")
      .map(Number);
    return Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
  }, painted);

/** Nothing in the band may move when the nav hides: every control it holds, to the pixel. */
const bandBoxes = async (page: Page, workspaceName: string, who: string) => ({
  band: await boxOf(bandOf(page)),
  logo: await boxOf(logoOf(page)),
  name: await boxOf(partOf(page, workspaceName)),
  switcher: await boxOf(switcherOf(page, workspaceName)),
  place: await boxOf(crumbsOf(page)),
  you: await boxOf(avatarOf(page, who)),
});

const signedIn = async (page: Page, api: Parameters<typeof provision>[0], name: string) => {
  const email = anAddress("shell");
  const workspace = await provision(api, { name, adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  return workspace;
};

/** Drawn before anything is measured or pressed, so the narrow shell is what answers. */
const narrowAtRoutesAndSpend = async (
  page: Page,
  api: Parameters<typeof provision>[0],
  name: string,
) => {
  await signedIn(page, api, name);
  await page.setViewportSize(NARROW);
  await page.goto(ROUTES_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();
};

test("names the icon rail's surfaces to eye, pointer and keyboard", async ({ page, request }) => {
  await signedIn(page, request, "Wharfedale Castings");
  await page.goto(ROUTES_AND_SPEND.path);

  const rail = railOf(page);
  await expect(rail.getByRole("link")).toHaveText(SURFACE_NAMES);

  // The keyboard first, before any pointer has opened one, then the pointer.
  const entry = rail.getByRole("link", { name: CONTROL_CENTRE.name });
  await tabUntilFocused(page, entry);
  const tooltip = page.getByRole("tooltip").filter({ hasText: CONTROL_CENTRE.name }).first();
  await expect(tooltip).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await entry.hover();
  await expect(tooltip).toBeVisible();
});

test("marks the open surface in the rail, on any screen", async ({ page, request }) => {
  await signedIn(page, request, "Pennine Metalwork");
  await page.goto("/people/groups");

  const rail = railOf(page);
  await expect(rail.getByRole("link", { name: CONTROL_CENTRE.name })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const marked = await rail
    .getByRole("link")
    .evaluateAll((links) => links.filter((link) => link.hasAttribute("aria-current")).length);
  expect(marked).toBe(1);

  // A fill where the others have none reads in greyscale, so the mark is not colour alone.
  expect(await paintedFill(page, CONTROL_CENTRE.name)).not.toBe("rgba(0, 0, 0, 0)");
});

test("lists the open surface's groups and screens, marking one", async ({ page, request }) => {
  await signedIn(page, request, "Northern Tooling");
  await page.goto("/system/audit-log");

  const nav = navOf(page, CONTROL_CENTRE);
  await expect(nav.getByRole("link")).toHaveText(SCREEN_NAMES);
  const open = nav.getByRole("link", { name: "Audit log" });
  await expect(open).toHaveAttribute("aria-current", "page");

  // Heavier and filled where its neighbours are neither, so it survives a greyscale screen.
  expect(await weightOf(page, "Audit log")).toBeGreaterThan(await weightOf(page, "Members"));
  expect(await greyOf(open, "own"), "the open screen's fill is the nav's own").not.toBe(
    await greyOf(open, "behind"),
  );

  // Each screen carries its glyph, and the open one's is set bold.
  const each = await nav
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.querySelector("svg") !== null));
  expect(each.every(Boolean), "a screen in the nav has no icon").toBe(true);
  const membersClosed = await glyphOf(page, "Members");

  // No heading repeats the surface the rail already names.
  await expect(nav).toMatchAriaSnapshot(`
    - navigation "Control Centre":
      - heading "Sources" [level=3]
      - list:
        - listitem:
          - link "Bindings"
      - heading "Agent Operations" [level=3]
      - list:
        - listitem:
          - link "Routes and spend"
      - heading "People" [level=3]
      - list:
        - listitem:
          - link "Members"
        - listitem:
          - link "Groups"
      - heading "System" [level=3]
      - list:
        - listitem:
          - link "Audit log"
  `);

  const started = Date.now();
  await nav.getByRole("link", { name: "Members" }).click();
  await expect(nav.getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "secondary nav move", description: `${elapsed} ms` });
  expect(elapsed).toBeLessThan(SWAP_BUDGET_MS);
  expect(await glyphOf(page, "Members"), "the open screen's glyph is not set bold").not.toBe(
    membersClosed,
  );

  // `goto` is the bookmark: a fresh document at a path no file sits at, not a click.
  await page.goto("/people/groups");
  await expect(navOf(page, CONTROL_CENTRE).getByRole("link", { name: "Groups" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
});

test("lists a Viewer's home as the nav's one entry (AE2)", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);

  const nav = page.getByRole("navigation", { name: ASK.name });
  await expect(nav.getByRole("link")).toHaveText([HOMES.Viewer.name]);
  await expect(nav.getByRole("link", { name: HOMES.Viewer.name })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await closerOf(page).click();
  await expect(nav).toHaveCount(0);
  await openerOf(page).click();
  await expect(nav).toBeVisible();
});

test("names workspace and place, the logo leading home", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Halifax Fabrication");
  await page.goto(ROUTES_AND_SPEND.path);

  await expect(switcherOf(page, workspace.name)).toBeVisible();
  for (const name of [CONTROL_CENTRE.name, AGENT_OPERATIONS.name, ROUTES_AND_SPEND.name]) {
    await expect(partOf(page, name)).toBeVisible();
  }
  await expect(bandOf(page).getByRole("button", { name: "Sign out" })).toHaveCount(0);

  // The logo is the way home from anywhere, named for the product rather than drawn alone.
  await expect(logoOf(page)).toHaveAttribute("href", HOMES.Admin.path);
  await logoOf(page).click();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
});

test("shows initials, with name and role one menu in", async ({ page, request }) => {
  const email = anAddress("initials");
  const workspace = await provision(request, { name: "Esholt Pressings" });
  const admin = await person(request, email, { displayName: LONG_PERSON });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: admin.id, role: "Admin" });
  await page.goto("/sign-in");
  await signIn(page, request, email);

  const you = avatarOf(page, LONG_PERSON);
  await expect(you).toHaveAccessibleName(LONG_PERSON);
  await expect(you).toHaveText(`BF${LONG_PERSON}`);
  await expect(you.getByText("BF", { exact: true })).toBeVisible();

  const menu = await personMenuOpened(page, LONG_PERSON);
  await expect(menu.getByText(LONG_PERSON, { exact: true })).toBeVisible();
  await expect(menu.getByText("Admin", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Sign out"]);
});

test("names surface, group, screen and open tab, following the tab", async ({ page, request }) => {
  await signedIn(page, request, "Hebden Castings");
  await page.goto(MEMBERS.path);
  await page.getByRole("tab", { name: "Invitations" }).click();

  const parts = crumbsOf(page).getByRole("listitem");
  await expect(parts).toHaveText([CONTROL_CENTRE.name, PEOPLE.name, MEMBERS.name, "Invitations"]);

  const started = Date.now();
  await page.getByRole("tab", { name: "Requests" }).click();
  await expect(parts).toHaveText([CONTROL_CENTRE.name, PEOPLE.name, MEMBERS.name, "Requests"]);
  const elapsed = Date.now() - started;
  test
    .info()
    .annotations.push({ type: "breadcrumb follows the tab", description: `${elapsed} ms` });
  expect(elapsed).toBeLessThan(SWAP_BUDGET_MS);
});

test("links each part but the last, the current page", async ({ page, request }) => {
  await signedIn(page, request, "Hebden Pressings");
  await page.goto(MEMBERS.path);
  await page.getByRole("tab", { name: "Invitations" }).click();

  // Control Centre opens on the Admin's home until Overview is built.
  for (const name of [CONTROL_CENTRE.name, PEOPLE.name, MEMBERS.name]) {
    await expect(crumbOf(page, name)).toHaveAttribute("href", MEMBERS.path);
    await expect(crumbOf(page, name)).not.toHaveAttribute("aria-current");
  }
  const current = crumbOf(page, "Invitations");
  await expect(current).toHaveAttribute("aria-current", "page");
  await expect(current).not.toHaveAttribute("href");

  await page.goto("/people/groups");
  await expect(crumbsOf(page).getByRole("listitem")).toHaveText([
    CONTROL_CENTRE.name,
    PEOPLE.name,
    "Groups",
  ]);
  await expect(crumbOf(page, PEOPLE.name)).toHaveAttribute("href", MEMBERS.path);
  await expect(crumbOf(page, "Groups")).toHaveAttribute("aria-current", "page");

  await crumbOf(page, CONTROL_CENTRE.name).click();
  await expect(page).toHaveURL(new RegExp(`${MEMBERS.path}$`));
});

test("names Ask once, with no group, on a Viewer's home", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);

  await expect(crumbsOf(page).getByRole("listitem")).toHaveText([ASK.name]);
  await expect(crumbOf(page, ASK.name)).toHaveAttribute("aria-current", "page");
  await expect(crumbOf(page, ASK.name)).not.toHaveAttribute("href");
});

test("keeps band, rail and nav mounted between screens, focus kept", async ({ page, request }) => {
  await signedIn(page, request, "Hebden Wireworks");
  await page.goto(MEMBERS.path);
  await expect(page.getByRole("heading", { level: 1, name: headingOf(MEMBERS) })).toBeVisible();

  const regions = [bandOf(page), railOf(page), navOf(page, CONTROL_CENTRE)];
  const before = await Promise.all(regions.map((region) => region.elementHandle()));

  const groups = navOf(page, CONTROL_CENTRE).getByRole("link", { name: "Groups" });
  await groups.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/people\/groups$/);
  await expect(groups).toHaveAttribute("aria-current", "page");
  await expect(groups, "focus left the chosen link").toBeFocused();
  for (const drawn of before) {
    expect(await drawn.evaluate((node) => node.isConnected), "a region was drawn again").toBe(true);
  }
});

test("sizes the band's cells to the rail and nav below", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Ryedale Castings");
  await page.setViewportSize(DESKTOP);
  await page.goto(MEMBERS.path);
  await expect(navOf(page, CONTROL_CENTRE)).toBeVisible();

  const band = await boxOf(bandOf(page));
  const rail = await boxOf(railOf(page));
  const nav = await boxOf(navOf(page, CONTROL_CENTRE));
  expect(band.x).toBe(0);
  expect(band.width).toBe(DESKTOP.width);
  expect(band.y + band.height, "the band does not sit above the rail").toBeLessThanOrEqual(rail.y);

  // The logo fills the first cell, so the cell is the rail's width.
  const logo = await boxOf(logoOf(page));
  expect(logo.x).toBe(rail.x);
  expect(logo.width).toBe(rail.width);

  // The second cell ends where the nav does, so the toggle and the name sit over the nav.
  const toggle = await boxOf(closerOf(page));
  const name = await boxOf(partOf(page, workspace.name));
  expect(name.x).toBeGreaterThanOrEqual(nav.x);
  expect(toggle.x + toggle.width).toBeLessThanOrEqual(nav.x + nav.width);
  expect(await leftOf(partOf(page, CONTROL_CENTRE.name))).toBeGreaterThanOrEqual(nav.x + nav.width);
});

test("tabs skip link, band, icon rail, secondary nav, toolbar, screen", async ({
  page,
  request,
}) => {
  const workspace = await signedIn(page, request, "Dales Engineering");
  await page.goto(ROUTES_AND_SPEND.path);
  const rail = railOf(page);
  await expect(rail.getByRole("link", { name: CONTROL_CENTRE.name })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await theRoutesHaveLanded(page);

  // Every part but the open tab leads somewhere, so each is a stop between toggle and jump-to.
  const band = [
    logoOf(page),
    switcherOf(page, workspace.name),
    closerOf(page),
    crumbOf(page, CONTROL_CENTRE.name),
    crumbOf(page, AGENT_OPERATIONS.name),
    crumbOf(page, ROUTES_AND_SPEND.name),
    jumpToOf(page),
    avatarOf(page, workspace.admin.name),
  ];
  expect(await inDocumentOrder(page, band), "the band reads out of order").toBe(true);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();

  for (const stop of band) {
    await page.keyboard.press("Tab");
    await expect(stop).toBeFocused();
  }

  for (const name of SURFACE_NAMES) {
    await page.keyboard.press("Tab");
    await expect(rail.getByRole("link", { name })).toBeFocused();
  }

  // The rail's foot, under its surfaces.
  await page.keyboard.press("Tab");
  await expect(keystrokesButton(rail)).toBeFocused();

  for (const name of SCREEN_NAMES) {
    await page.keyboard.press("Tab");
    await expect(navOf(page, CONTROL_CENTRE).getByRole("link", { name })).toBeFocused();
  }

  await page.keyboard.press("Tab");
  await expect(tabsOf(page).getByRole("tab", { name: "Routes" })).toBeFocused();

  // The open tab's panel holds the screen, so the content is reached through the toolbar.
  const panel = page.getByRole("tabpanel");
  await page.keyboard.press("Tab");
  await expect(panel).toBeFocused();
  await expect(panel.getByRole("region", { name: "Routes" })).toBeVisible();

  /**
   * Nothing carries a positive tabindex, so the document's own order is the tab order. Zero
   * is not positive: the open tab's panel carries one.
   */
  const contentIsLast = await page.evaluate(() => {
    const bar = document.querySelector("header");
    const content = document.querySelector("main");
    if (bar === null || content === null) return false;
    const following = bar.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING;
    const jumped = [...document.querySelectorAll("[tabindex]")].some(
      (element) => Number(element.getAttribute("tabindex")) > 0,
    );
    return following !== 0 && !jumped;
  });
  expect(contentIsLast).toBe(true);
});

// Its own test, not the tail of the one above: the skip link is the first stop, so it needs
// a screen with nothing focused.
test("moves focus from the skip link into the content", async ({ page, request }) => {
  await signedIn(page, request, "Ribble Toolmaking");
  await page.goto(ROUTES_AND_SPEND.path);
  // A keypress before the shell has drawn is spent on nothing, so wait for the screen first.
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();

  await skipLinkReachesTheScreen(page);
});

test("scrolls nothing sideways at 320 pixels, navigation open or closed", async ({
  page,
  request,
}) => {
  await narrowAtRoutesAndSpend(page, request, "Acme Joinery");

  await scrollsNothingSideways(page, "with the sheet closed");

  const bar = await topOf(bandOf(page));
  const content = await topOf(page.getByRole("main"));
  expect(bar).toBeLessThan(content);

  await sheetButtonOf(page).click();
  await expect(sheetOf(page)).toBeVisible();

  await scrollsNothingSideways(page, "with the sheet open");
});

test("names all four parts at 320 pixels, clipping none", async ({ page, request }) => {
  // Long names in both of the first row's texts, so neither can push the row past the edge.
  const email = anAddress("long-names");
  const workspace = await provision(request, { name: LONG_NAME });
  const admin = await person(request, email, { displayName: LONG_PERSON });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: admin.id, role: "Admin" });
  await page.setViewportSize(NARROW);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(MEMBERS.path);
  await expect(page.getByRole("heading", { level: 1, name: headingOf(MEMBERS) })).toBeVisible();
  await page.getByRole("tab", { name: "Invitations" }).click();

  // Its own row under the controls, so a long workspace name takes nothing from it.
  const row = await boxOf(sheetButtonOf(page));
  const parts = [CONTROL_CENTRE.name, PEOPLE.name, MEMBERS.name, "Invitations"];
  await expect(crumbsOf(page).getByRole("listitem")).toHaveText(parts);
  for (const name of parts) {
    const part = crumbOf(page, name);
    await expect(part).toBeVisible();
    const box = await boxOf(part);
    expect(box.y, `${name} shares the controls' row`).toBeGreaterThanOrEqual(row.y + row.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${name} is clipped`).toBeLessThanOrEqual(NARROW.width);
    const cut = await part.evaluate(
      (node) =>
        node.scrollWidth > node.clientWidth || getComputedStyle(node).textOverflow !== "clip",
    );
    expect(cut, `${name} is cut short`).toBe(false);
  }
  await expect(crumbOf(page, "Invitations")).toHaveAttribute("aria-current", "page");

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    NARROW.width,
  );
});

test("narrows the band to two rows scrolling with the page", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Swaledale Ironworks");
  await page.setViewportSize(NARROW_AND_SHORT);
  await page.goto(MEMBERS.path);
  await expect(page.getByRole("heading", { level: 1, name: headingOf(MEMBERS) })).toBeVisible();

  const firstRow = [
    sheetButtonOf(page),
    logoOf(page),
    switcherOf(page, workspace.name),
    jumpToOf(page),
    keystrokesButton(bandOf(page)),
    avatarOf(page, workspace.admin.name),
  ];
  const place = await boxOf(crumbsOf(page));
  let before = Number.NEGATIVE_INFINITY;
  for (const control of firstRow) {
    const box = await boxOf(control);
    expect(box.x, "the first row is out of order").toBeGreaterThan(before);
    expect(box.y + box.height, "the place shares the first row").toBeLessThanOrEqual(place.y);
    before = box.x;
  }

  // From the top to the last member row: first row, the parts that lead somewhere, toolbar, screen.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();
  for (const stop of [
    ...firstRow,
    crumbOf(page, CONTROL_CENTRE.name),
    crumbOf(page, PEOPLE.name),
    page.getByRole("tab", { name: MEMBERS.name }),
    page.getByRole("main").getByRole("button", { name: workspace.admin.name, exact: true }),
  ]) {
    await tabClearOfTheBand(page, stop);
  }

  await scrollsNothingSideways(page, "with the band on two rows");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.wheel(0, NARROW_AND_SHORT.height);
  await expect
    .poll(async () => (await boxOf(bandOf(page))).y, { message: "the band stays in view" })
    .toBeLessThan(0);
});

test("opens the keystrokes from the narrow band, focus returned (R15)", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await signedIn(page, request, "Wensleydale Forge");
  await page.setViewportSize(NARROW);
  await page.goto(MEMBERS.path);
  await expect(page.getByRole("heading", { level: 1, name: headingOf(MEMBERS) })).toBeVisible();

  // The rail lives in the sheet here, a dialog the keystrokes ignore, so the band holds the one.
  const trigger = keystrokesButton(bandOf(page));
  await expect(keystrokesButton(page)).toHaveCount(1);
  await expect(trigger).toHaveAttribute("aria-keyshortcuts", "?");

  const listed = await keystrokesListed(page, MEMBERS.name);
  await expect(listed).toContainText(JUMP_TO.name);
  await scrollsNothingSideways(page, "with the keystrokes open");
  await passesTheAccessibilityGate();
  await keystrokesDismissed(page, listed);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(page.getByRole("dialog", { name: keystrokesOn(MEMBERS.name) })).toBeVisible();
});

test("keeps a focused control clear of the fixed band", async ({ page, request }) => {
  const email = anAddress("long-list");
  const workspace = await provision(request, { name: "Longdendale Wire", adminEmail: email });
  for (let at = 1; at <= 12; at += 1) {
    const member = await person(request, anAddress("member"), { displayName: `Member ${at}` });
    await addMember(request, {
      workspaceId: workspace.workspaceId,
      userId: member.id,
      role: "Viewer",
    });
  }
  await page.setViewportSize({ width: DESKTOP.width, height: 400 });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(MEMBERS.path);
  const last = page.getByRole("main").getByRole("button", { name: "Member 9" });
  await expect(last).toBeVisible();

  // Backwards, so each stop scrolls up to meet the band rather than rise from below it.
  await tabUntilFocused(page, last, 80);
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusUnderTheBand(page), `stop ${step + 1} back sits under the band`).toBe(false);
  }
});

test("paints the shell in the page's own surface token", async ({ page, request }) => {
  await signedIn(page, request, "Southern Castings");
  await page.goto(ROUTES_AND_SPEND.path);

  const painted = await page.locator("main").evaluate((main) => {
    const nothing = "rgba(0, 0, 0, 0)";
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--surface-page)";
    document.body.append(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();

    /**
     * The first painted ancestor is what a reader sees behind the screen, whatever the number
     * of layout wrappers between.
     */
    let behind = main.parentElement;
    while (behind !== null && getComputedStyle(behind).backgroundColor === nothing) {
      behind = behind.parentElement;
    }
    return { behind: behind === null ? nothing : getComputedStyle(behind).backgroundColor, token };
  });
  expect(painted.token).not.toBe("rgba(0, 0, 0, 0)");
  expect(painted.behind).toBe(painted.token);
});

test("fills the toolbar with tabs the arrow keys move between", async ({ page, request }) => {
  await signedIn(page, request, "Calder Ironworks");
  await page.goto(ROUTES_AND_SPEND.path);

  const tabs = tabsOf(page);
  await expect(tabs.getByRole("tab")).toHaveText(TOOLBAR_TABS);
  await expect(tabs).toMatchAriaSnapshot(`
    - tablist "Routes and spend":
      - tab "Routes" [selected]
      - tab "Spend"
  `);

  // The region is the shell's own, between the band and the content and inside neither.
  const bar = await topOf(bandOf(page));
  const toolbar = await topOf(tabs);
  const content = await topOf(page.getByRole("main"));
  expect(bar).toBeLessThan(toolbar);
  expect(toolbar).toBeLessThan(content);

  // The arrows and the selection are the registry's, so the shell rolls no keyboard of its own.
  await tabs.getByRole("tab", { name: "Routes" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Spend" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Spend is not built yet.")).toBeVisible();
  await expect(routesCardOf(page)).toHaveCount(0);

  await page.keyboard.press("ArrowLeft");
  await expect(routesCardOf(page)).toBeVisible();
});

test("draws no toolbar over a screen without tabs or acts", async ({ page, request }) => {
  await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);
  await expect(
    page.getByRole("heading", { level: 1, name: headingOf(HOMES.Viewer) }),
  ).toBeVisible();

  await expect(page.getByRole("tablist")).toHaveCount(0);

  /** An empty bar is what this forbids, so the content must open its own column. */
  const met = await page.evaluate(
    () => document.querySelector("main")?.previousElementSibling === null,
  );
  expect(met).toBe(true);
});

test("holds toggle and band still while the nav hides (AE1)", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await signedIn(page, request, "Calder Pattern Works");
  await page.setViewportSize(DESKTOP);
  await page.goto(MEMBERS.path);

  const nav = navOf(page, CONTROL_CENTRE);
  await expect(nav).toBeVisible();
  const tabs = page.getByRole("tablist", { name: MEMBERS.name });
  await expect(tabs).toBeVisible();
  const navWide = await widthOf(nav);
  const rail = await boxOf(railOf(page));
  const band = await bandBoxes(page, workspace.name, workspace.admin.name);
  const main = await boxOf(page.getByRole("main"));
  const tabsAt = await leftOf(tabs);

  const close = closerOf(page);
  const toggle = await boxOf(close);
  await expect(close).toHaveAttribute("aria-expanded", "true");
  expect(await nav.getAttribute("id")).toBe(await close.getAttribute("aria-controls"));

  const started = Date.now();
  await close.click();
  await expect(nav).toHaveCount(0);
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "closing the secondary nav", description: `${elapsed} ms` });
  expect(elapsed).toBeLessThan(ACT_BUDGET_MS);

  // The toggle, the band and the rail are where they were, to the pixel: only the nav left.
  const open = openerOf(page);
  expect(await boxOf(open), "the toggle moved as the nav hid").toEqual(toggle);
  expect(await bandBoxes(page, workspace.name, workspace.admin.name)).toEqual(band);
  expect(await boxOf(railOf(page))).toEqual(rail);

  // The toolbar shares the content's column, so both start the nav's width further left.
  const hidden = await boxOf(page.getByRole("main"));
  test.info().annotations.push({
    type: "AE1 at 1440",
    description: `toggle ${JSON.stringify(toggle)}; main ${main.width} to ${hidden.width}; nav ${navWide}`,
  });
  expect(hidden.x).toBe(main.x - navWide);
  expect(hidden.width).toBe(main.width + navWide);
  expect(await leftOf(tabs)).toBe(tabsAt - navWide);

  // Audited closed here; the fixture audits the open state the test ends on.
  await passesTheAccessibilityGate();

  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(nav).toBeVisible();
  expect(await boxOf(closerOf(page)), "the toggle moved as the nav came back").toEqual(toggle);
  expect(await bandBoxes(page, workspace.name, workspace.admin.name)).toEqual(band);
  expect(await boxOf(page.getByRole("main"))).toEqual(main);
});

test("holds the toggle in place beside a 60-character workspace name", async ({
  page,
  request,
}) => {
  expect(LONG_NAME).toHaveLength(60);
  const email = anAddress("long");
  const short = await provision(request, { name: "Airedale Press", adminEmail: email });
  const long = await provision(request, { name: LONG_NAME });
  await addMember(request, {
    workspaceId: long.workspaceId,
    userId: short.admin.id,
    role: "Admin",
  });
  await page.setViewportSize(DESKTOP);
  await page.goto("/sign-in");
  await signIn(page, request, email);

  const toggleIn = async (name: string) => {
    await page.goto("/choose-workspace");
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
    await expect(partOf(page, name)).toBeVisible();
    // The switcher's accessible name is the whole name, however much of it shows.
    await expect(switcherOf(page, name)).toBeVisible();
    return boxOf(closerOf(page));
  };

  const beside = await toggleIn(short.name);
  const besideTheLongOne = await toggleIn(LONG_NAME);
  test.info().annotations.push({
    type: "toggle beside a 60-character name",
    description: `${JSON.stringify(beside)} and ${JSON.stringify(besideTheLongOne)}`,
  });
  expect(besideTheLongOne, "a long workspace name moved the toggle").toEqual(beside);

  // Cut with an ellipsis on screen, whole in the document, so a screen reader hears it all.
  const cut = await partOf(page, LONG_NAME).evaluate((node) => ({
    whole: node.textContent,
    ellipsis: getComputedStyle(node).textOverflow,
    overflows: node.scrollWidth > node.clientWidth,
  }));
  expect(cut).toEqual({ whole: LONG_NAME, ellipsis: "ellipsis", overflows: true });
});

test("keeps a 40-character address on one line, prose measured (AE6)", async ({
  page,
  request,
}) => {
  const email = anAddress("wide");
  const workspace = await provision(request, { name: "Holme Valley Tools", adminEmail: email });
  const address = `i${Date.now()}${Math.floor(Math.random() * 1e6)}`
    .padEnd(27, "0")
    .concat("@example.test");
  expect(address).toHaveLength(40);
  await invite(request, {
    workspaceId: workspace.workspaceId,
    email: address,
    inviterId: workspace.admin.id,
    role: "Viewer",
  });
  await page.setViewportSize(DESKTOP);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(MEMBERS.path);
  await page.getByRole("tab", { name: "Invitations" }).click();

  const cell = page.getByRole("main").getByRole("cell", { name: address, exact: true });
  await expect(cell).toBeVisible();
  const lines = await cell.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(lines, "the address wraps").toBe(1);

  const summary = page.getByRole("main").getByText(PEOPLE.summary, { exact: true });
  const measure = await summary.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).maxWidth),
  );
  expect(Number.isFinite(measure), "the description has no measure").toBe(true);
  expect(await widthOf(summary)).toBeLessThanOrEqual(measure);
  expect(
    await widthOf(page.getByRole("main").getByRole("table")),
    "the table is held to the measure",
  ).toBeGreaterThan(measure);
});

test("remembers a closed secondary nav on this browser only", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Ribble Toolmaking");
  await page.goto(ROUTES_AND_SPEND.path);
  await expect(navOf(page, CONTROL_CENTRE)).toBeVisible();
  await theRoutesHaveLanded(page);

  // Listening only across the act, so neither the start above nor the reload below is mistaken
  // for it.
  const asked: string[] = [];
  const noting = (each: { url: () => string }) => asked.push(each.url());
  page.on("request", noting);
  await closerOf(page).click();
  await expect(navOf(page, CONTROL_CENTRE)).toHaveCount(0);
  page.off("request", noting);
  expect(asked).toEqual([]);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();
  await expect(navOf(page, CONTROL_CENTRE)).toHaveCount(0);
  await expect(openerOf(page)).toBeVisible();

  const kept = await keptOnThisBrowser(page);
  const theNavs = kept.filter((entry) => / (open|closed)$/.test(entry));
  expect(theNavs, "the nav's choice is not kept once").toHaveLength(1);
  const secrets = [
    workspace.admin.email,
    workspace.admin.name,
    workspace.admin.id,
    workspace.workspaceId,
  ];
  for (const entry of kept) {
    for (const secret of secrets) expect(entry).not.toContain(secret);
  }
});

test("opens the navigation over narrow content, holding and returning focus", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await narrowAtRoutesAndSpend(page, request, "Wharfedale Castings");

  await expect(railOf(page)).toHaveCount(0);
  await expect(navOf(page, CONTROL_CENTRE)).toHaveCount(0);
  const contentWide = await widthOf(page.getByRole("main"));

  const menu = sheetButtonOf(page);
  await menu.click();
  const panel = sheetOf(page);
  await expect(panel.getByRole("navigation", { name: RAIL })).toBeVisible();
  await expect(panel.getByRole("navigation", { name: CONTROL_CENTRE.name })).toBeVisible();
  await expect(panel.getByRole("link")).toHaveText([...SURFACE_NAMES, ...SCREEN_NAMES]);

  // Over the content, not beside it: the content keeps every pixel it had.
  expect(await widthOf(page.getByRole("main"))).toBe(contentWide);

  /**
   * Twice round every stop it holds — the destinations and its way out — so a reader behind
   * it can never tab onto the screen.
   */
  const stops = SURFACE_NAMES.length + SCREEN_NAMES.length + 1;
  expect(await holdsFocus(panel)).toBe(true);
  for (let step = 0; step < stops * 2; step += 1) {
    await page.keyboard.press("Tab");
    expect(await holdsFocus(panel)).toBe(true);
  }

  await passesTheAccessibilityGate();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test("closes the sheet on a chosen screen, focus returned (AE7)", async ({ page, request }) => {
  await narrowAtRoutesAndSpend(page, request, "Northern Tooling");
  await scrollsNothingSideways(page, "before the sheet opens");

  const menu = sheetButtonOf(page);
  await menu.click();
  await expect(sheetOf(page)).toBeVisible();
  await scrollsNothingSideways(page, "with the sheet open");
  await sheetOf(page).getByRole("link", { name: "Audit log" }).click();

  await expect(sheetOf(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  await expect(menu).toBeFocused();
  await scrollsNothingSideways(page, "once the sheet has closed");

  await menu.click();
  await sheetOf(page).getByRole("link", { name: CONTROL_CENTRE.name }).click();

  await expect(sheetOf(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(menu).toBeFocused();
});

test("closes the sheet on widening, focusing the navigation control", async ({ page, request }) => {
  await narrowAtRoutesAndSpend(page, request, "Calder Pressings");

  await sheetButtonOf(page).click();
  await expect(sheetOf(page)).toBeVisible();

  // The reader never asked for this crossing, so the sheet owes back the focus it borrowed —
  // vanishing would leave it on the body.
  await page.setViewportSize(WIDE);

  await expect(sheetOf(page)).toHaveCount(0);
  await expect(railOf(page)).toBeVisible();
  await expect(navOf(page, CONTROL_CENTRE)).toBeVisible();
  await expect(closerOf(page)).toBeFocused();
});

test("leads each built screen with its group's line, auditing each", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await signedIn(page, request, "Swaledale Foundry");

  for (const group of AN_ADMINS.flatMap((surface) => surface.groups)) {
    for (const screen of group.screens) {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: headingOf(screen) })).toBeVisible();
      await expect(
        page.getByRole("main").getByText(group.summary ?? "", { exact: true }),
      ).toBeVisible();
      await passesTheAccessibilityGate();
    }
  }
});
