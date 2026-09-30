import type { Locator, Page } from "@playwright/test";

import { RAIL } from "@/app/words.ts";
import { ROUTES_WORDS } from "@/features/routes/words.ts";
import {
  CONTROL_CENTRE,
  groupIn,
  headingOf,
  HOMES,
  screenNamed,
  SURFACES,
  visibleTo,
} from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  aMemberSignedInAt,
  anAddress,
  provision,
  signIn,
  skipLinkReachesTheScreen,
} from "./harness.ts";

/** What an Admin is shown today, read off the list: Control Centre and its built screens. */
const AN_ADMINS = visibleTo({ role: "Admin", owns: [] }, SURFACES).surfaces;

const SURFACE_NAMES = AN_ADMINS.map((surface) => surface.name);

const SCREEN_NAMES = AN_ADMINS.flatMap((surface) =>
  surface.groups.flatMap((group) => group.screens.map((each) => each.name)),
);

const ROUTES_AND_SPEND = screenNamed(
  groupIn(CONTROL_CENTRE, "agent-operations"),
  "Routes and spend",
);

/** The first heading Routes and spend draws: its group's name. */
const ITS_HEADING = headingOf(ROUTES_AND_SPEND);

const SWAP_BUDGET_MS = 1000;

const ACT_BUDGET_MS = 100;

const NARROW = { width: 320, height: 720 };

/** Past `--breakpoint-md`, which `--shell-wide` in `index.css` reads for the shell. */
const WIDE = { width: 1024, height: 720 };

const SCREENS_AND_VIEWS = "Screens and views";

const railOf = (page: Page) => page.getByRole("navigation", { name: RAIL });

const navOf = (page: Page) => page.getByRole("navigation", { name: CONTROL_CENTRE.name });

const closerOf = (page: Page) => page.getByRole("button", { name: "Hide the secondary nav" });

const openerOf = (page: Page) => page.getByRole("button", { name: "Show the secondary nav" });

const menuOf = (page: Page) => page.getByRole("button", { name: SCREENS_AND_VIEWS });

const panelOf = (page: Page) => page.getByRole("dialog", { name: SCREENS_AND_VIEWS });

const topOf = async (region: Locator): Promise<number> =>
  (await region.boundingBox())?.y ?? Number.NaN;

const widthOf = async (region: Locator): Promise<number> =>
  (await region.boundingBox())?.width ?? Number.NaN;

const leftOf = async (region: Locator): Promise<number> =>
  (await region.boundingBox())?.x ?? Number.NaN;

const sidewaysRoom = (page: Page) =>
  page.evaluate(() => ({
    scrolls: document.documentElement.scrollWidth,
    holds: document.documentElement.clientWidth,
  }));

const holdsFocus = (panel: Locator) =>
  panel.evaluate((node) => node.contains(document.activeElement));

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
  navOf(page)
    .getByRole("link", { name: screenName })
    .evaluate((link) => Number.parseInt(getComputedStyle(link).fontWeight, 10));

const signedIn = async (page: Page, api: Parameters<typeof provision>[0], name: string) => {
  const email = anAddress("shell");
  const workspace = await provision(api, { name, adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  return workspace;
};

test("names the icon rail's surfaces to eye, pointer and keyboard", async ({ page, request }) => {
  await signedIn(page, request, "Wharfedale Castings");
  await page.goto(ROUTES_AND_SPEND.path);

  const rail = railOf(page);
  await expect(rail.getByRole("link")).toHaveText(SURFACE_NAMES);

  // The keyboard first, before any pointer has opened one, then the pointer.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const entry = rail.getByRole("link", { name: CONTROL_CENTRE.name });
  await expect(entry).toBeFocused();
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

  const nav = navOf(page);
  await expect(nav.getByRole("link")).toHaveText(SCREEN_NAMES);
  await expect(nav.getByRole("link", { name: "Audit log" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Set heavier than its neighbours, so the current screen survives a greyscale screen.
  expect(await weightOf(page, "Audit log")).toBeGreaterThan(await weightOf(page, "Members"));

  await expect(nav).toMatchAriaSnapshot(`
    - navigation "Control Centre":
      - heading "Control Centre" [level=2]
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

  // `goto` is the bookmark: a fresh document at a path no file sits at, not a click.
  await page.goto("/people/groups");
  await expect(navOf(page).getByRole("link", { name: "Groups" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
});

test("names workspace, group, screen, person, role in the top bar", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Halifax Fabrication");
  await page.goto(ROUTES_AND_SPEND.path);

  const bar = page.getByRole("banner");
  await expect(bar.getByText(workspace.name)).toBeVisible();
  await expect(bar.getByText(ITS_HEADING, { exact: true })).toBeVisible();
  await expect(bar.getByText(ROUTES_AND_SPEND.name, { exact: true })).toBeVisible();

  const you = bar.getByRole("button", { name: new RegExp(workspace.admin.name) });
  await expect(you).toContainText("Admin");
  await expect(bar.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await you.click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});

test("tabs skip link, icon rail, secondary nav, top bar, screen", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Dales Engineering");
  await page.goto(ROUTES_AND_SPEND.path);
  const rail = railOf(page);
  await expect(rail.getByRole("link", { name: CONTROL_CENTRE.name })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();

  for (const name of SURFACE_NAMES) {
    await page.keyboard.press("Tab");
    await expect(rail.getByRole("link", { name })).toBeFocused();
  }

  for (const name of SCREEN_NAMES) {
    await page.keyboard.press("Tab");
    await expect(navOf(page).getByRole("link", { name })).toBeFocused();
  }

  // The control over the navigation opens the top bar, where it is the same corner a narrow
  // screen reaches the navigation from.
  await page.keyboard.press("Tab");
  await expect(closerOf(page)).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("banner").getByRole("button", { name: new RegExp(workspace.admin.name) }),
  ).toBeFocused();

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
  await signedIn(page, request, "Acme Joinery");
  await page.setViewportSize(NARROW);
  await page.goto(ROUTES_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();

  const closed = await sidewaysRoom(page);
  expect(closed.scrolls).toBeLessThanOrEqual(closed.holds);

  const bar = await topOf(page.getByRole("banner"));
  const content = await topOf(page.getByRole("main"));
  expect(bar).toBeLessThan(content);

  await menuOf(page).click();
  await expect(panelOf(page)).toBeVisible();

  const open = await sidewaysRoom(page);
  expect(open.scrolls).toBeLessThanOrEqual(open.holds);
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

const TOOLBAR_TABS = ["Routes", "Spend"];

const tabsOf = (page: Page) => page.getByRole("tablist", { name: "Routes and spend" });

const routesCardOf = (page: Page) => page.getByRole("region", { name: "Routes" });

/**
 * The screen reads the routes after the nav paints, so a screen here has started only once its
 * card says a new workspace has none.
 */
const theRoutesHaveLanded = (page: Page) =>
  expect(routesCardOf(page).getByText(ROUTES_WORDS.noneSet, { exact: true })).toBeVisible();

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

  // The region is the shell's own, between the top bar and the content and inside neither.
  const bar = await topOf(page.getByRole("banner"));
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

  /** An empty bar is what this forbids, so the content must follow the top bar itself. */
  const met = await page.evaluate(
    () => document.querySelector("header")?.nextElementSibling === document.querySelector("main"),
  );
  expect(met).toBe(true);
});

test("tabs to the toolbar between the top bar and content", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Wensleydale Precision");
  await page.goto(ROUTES_AND_SPEND.path);
  await theRoutesHaveLanded(page);

  // The order down to the top bar is another test's; starting at its last stop proves this
  // claim without proving that one twice.
  await page
    .getByRole("banner")
    .getByRole("button", { name: new RegExp(workspace.admin.name) })
    .focus();

  await page.keyboard.press("Tab");
  await expect(tabsOf(page).getByRole("tab", { name: "Routes" })).toBeFocused();

  // The open tab's panel holds the screen, so the content is reached through the toolbar.
  const panel = page.getByRole("tabpanel");
  await page.keyboard.press("Tab");
  await expect(panel).toBeFocused();
  await expect(panel.getByRole("region", { name: "Routes" })).toBeVisible();
});

test("toggles the secondary nav on the navigation control, freeing width", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await signedIn(page, request, "Calder Pattern Works");
  await page.goto(ROUTES_AND_SPEND.path);

  const nav = navOf(page);
  await expect(nav).toBeVisible();
  await expect(tabsOf(page).getByRole("tab")).toHaveText(TOOLBAR_TABS);
  const rail = railOf(page);
  const railAt = await leftOf(rail);
  const railWide = await widthOf(rail);
  const contentAt = await leftOf(page.getByRole("main"));
  const contentWide = await widthOf(page.getByRole("main"));
  const tabsAt = await leftOf(tabsOf(page));

  const close = closerOf(page);
  await expect(close).toHaveAttribute("aria-expanded", "true");
  expect(await nav.getAttribute("id")).toBe(await close.getAttribute("aria-controls"));

  const started = Date.now();
  await close.click();
  await expect(nav).toHaveCount(0);
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "closing the secondary nav", description: `${elapsed} ms` });
  expect(elapsed).toBeLessThan(ACT_BUDGET_MS);

  // The rail is where it was, to the pixel: only the nav left the row.
  await expect(rail).toBeVisible();
  expect(await leftOf(rail)).toBe(railAt);
  expect(await widthOf(rail)).toBe(railWide);

  /**
   * The toolbar shares the content's column, so one distance answers for both: each starts
   * that much further left, and the content is that much wider.
   */
  const freed = contentAt - (await leftOf(page.getByRole("main")));
  expect(freed).toBeGreaterThan(0);
  expect(await widthOf(page.getByRole("main"))).toBe(contentWide + freed);
  expect(await leftOf(tabsOf(page))).toBe(tabsAt - freed);

  // Audited closed here; the fixture audits the open state the test ends on.
  await passesTheAccessibilityGate();

  const open = openerOf(page);
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(nav).toBeVisible();
});

test("remembers a closed secondary nav on this browser only", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Ribble Toolmaking");
  await page.goto(ROUTES_AND_SPEND.path);
  await expect(navOf(page)).toBeVisible();
  await theRoutesHaveLanded(page);

  // Listening only across the act, so neither the start above nor the reload below is mistaken
  // for it.
  const asked: string[] = [];
  const noting = (each: { url: () => string }) => asked.push(each.url());
  page.on("request", noting);
  await closerOf(page).click();
  await expect(navOf(page)).toHaveCount(0);
  page.off("request", noting);
  expect(asked).toEqual([]);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();
  await expect(navOf(page)).toHaveCount(0);
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
  await signedIn(page, request, "Wharfedale Castings");
  await page.setViewportSize(NARROW);
  await page.goto(ROUTES_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();

  await expect(railOf(page)).toHaveCount(0);
  await expect(navOf(page)).toHaveCount(0);
  const contentWide = await widthOf(page.getByRole("main"));

  const menu = menuOf(page);
  await menu.click();
  const panel = panelOf(page);
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

test("closes the navigation over the content on a chosen destination", async ({
  page,
  request,
}) => {
  await signedIn(page, request, "Northern Tooling");
  await page.setViewportSize(NARROW);
  await page.goto(ROUTES_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();

  const menu = menuOf(page);
  await menu.click();
  await panelOf(page).getByRole("link", { name: "Audit log" }).click();

  await expect(panelOf(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  await expect(menu).toBeFocused();

  await menu.click();
  await panelOf(page).getByRole("link", { name: CONTROL_CENTRE.name }).click();

  await expect(panelOf(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
});

test("closes Screens and views on widening, focusing the navigation control", async ({
  page,
  request,
}) => {
  await signedIn(page, request, "Calder Pressings");
  await page.setViewportSize(NARROW);
  await page.goto(ROUTES_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();

  await menuOf(page).click();
  await expect(panelOf(page)).toBeVisible();

  // The reader never asked for this crossing, so the sheet owes back the focus it borrowed —
  // vanishing would leave it on the body.
  await page.setViewportSize(WIDE);

  await expect(panelOf(page)).toHaveCount(0);
  await expect(railOf(page)).toBeVisible();
  await expect(navOf(page)).toBeVisible();
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
