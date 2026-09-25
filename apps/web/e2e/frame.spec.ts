import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";

import { anAddress, provision, signIn, skipLinkReachesTheScreen } from "./harness.ts";

const SCREEN_NAMES = ["Sources", "Suggestions", "Knowledge", "Questions", "People", "System"];

const SYSTEM_VIEWS = ["Signals", "Health", "Routes and spend", "Backups"];

const SWAP_BUDGET_MS = 1000;

const ACT_BUDGET_MS = 100;

const NARROW = { width: 320, height: 720 };

/** Past `--breakpoint-md`, which `--shell-wide` in `index.css` reads for the shell. */
const WIDE = { width: 1024, height: 720 };

const SCREENS_AND_VIEWS = "Screens and views";

const railOf = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const navOf = (page: Page, screenName: string) =>
  page.getByRole("navigation", { name: screenName });

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

const weightOf = (page: Page, screenName: string, viewName: string) =>
  page
    .getByRole("navigation", { name: screenName })
    .getByRole("link", { name: viewName })
    .evaluate((link) => Number.parseInt(getComputedStyle(link).fontWeight, 10));

const signedIn = async (page: Page, api: Parameters<typeof provision>[0], name: string) => {
  const email = anAddress("shell");
  const workspace = await provision(api, { name, adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  return workspace;
};

test("names the icon rail's screens to eye, pointer and keyboard", async ({ page, request }) => {
  await signedIn(page, request, "Wharfedale Castings");
  await page.goto("/system/routes-and-spend");

  const rail = railOf(page);
  await expect(rail.getByRole("link")).toHaveText(SCREEN_NAMES);

  // The keyboard first, before any pointer has opened one, then the pointer on another
  // entry: one provider shows one tooltip at a time.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(rail.getByRole("link", { name: "Sources" })).toBeFocused();
  await expect(page.getByRole("tooltip").filter({ hasText: "Sources" }).first()).toBeVisible();

  await rail.getByRole("link", { name: "People" }).hover();
  await expect(page.getByRole("tooltip").filter({ hasText: "People" }).first()).toBeVisible();
});

test("marks only the screen being read in the icon rail", async ({ page, request }) => {
  await signedIn(page, request, "Pennine Metalwork");
  await page.goto("/people/thresholds");

  const rail = railOf(page);
  await expect(rail.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
  const marked = await rail
    .getByRole("link")
    .evaluateAll((links) => links.filter((link) => link.hasAttribute("aria-current")).length);
  expect(marked).toBe(1);

  // A fill where the others have none reads in greyscale, so the mark is not colour alone.
  expect(await paintedFill(page, "People")).not.toBe("rgba(0, 0, 0, 0)");
  expect(await paintedFill(page, "System")).toBe("rgba(0, 0, 0, 0)");
});

test("lists, marks and swaps the secondary nav's views by screen", async ({ page, request }) => {
  await signedIn(page, request, "Northern Tooling");
  await page.goto("/system/health");

  const system = page.getByRole("navigation", { name: "System" });
  await expect(system.getByRole("link")).toHaveText(SYSTEM_VIEWS);
  await expect(system.getByRole("link", { name: "Health" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Set heavier than its neighbours, so the current view survives a greyscale screen.
  expect(await weightOf(page, "System", "Health")).toBeGreaterThan(
    await weightOf(page, "System", "Backups"),
  );

  await expect(system).toMatchAriaSnapshot(`
    - navigation "System":
      - heading "System" [level=2]
      - list:
        - listitem:
          - link "Signals"
        - listitem:
          - link "Health"
        - listitem:
          - link "Routes and spend"
        - listitem:
          - link "Backups"
  `);

  const started = Date.now();
  await railOf(page).getByRole("link", { name: "Knowledge" }).click();
  const knowledge = page.getByRole("navigation", { name: "Knowledge" });
  await expect(knowledge.getByRole("link")).toHaveText([
    "Review table",
    "Conflicts and verification requests",
    "Exports",
  ]);
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "secondary nav swap", description: `${elapsed} ms` });
  expect(elapsed).toBeLessThan(SWAP_BUDGET_MS);

  await expect(page.getByRole("navigation", { name: "System" })).toHaveCount(0);
  await expect(page.getByText("This view is not built yet.")).toBeVisible();

  // `goto` is the bookmark: a fresh document at a path no file sits at, not a click.
  await page.goto("/people/erasure-and-suppression");
  await expect(
    page
      .getByRole("navigation", { name: "People" })
      .getByRole("link", { name: "Erasure and suppression" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { level: 2, name: "Erasure and suppression" }),
  ).toBeVisible();
});

test("names workspace, screen, view, person, role in the top bar", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Halifax Fabrication");
  await page.goto("/system/routes-and-spend");

  const bar = page.getByRole("banner");
  await expect(bar.getByText(workspace.name)).toBeVisible();
  await expect(bar.getByText("System", { exact: true })).toBeVisible();
  await expect(bar.getByText("Routes and spend", { exact: true })).toBeVisible();

  const you = bar.getByRole("button", { name: new RegExp(workspace.admin.name) });
  await expect(you).toContainText("Admin");
  await expect(bar.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await you.click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});

test("tabs skip link, icon rail, secondary nav, top bar, screen", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Dales Engineering");
  await page.goto("/system/routes-and-spend");
  const rail = railOf(page);
  await expect(rail.getByRole("link", { name: "System" })).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();

  for (const name of SCREEN_NAMES) {
    await page.keyboard.press("Tab");
    await expect(rail.getByRole("link", { name })).toBeFocused();
  }

  const system = page.getByRole("navigation", { name: "System" });
  for (const name of SYSTEM_VIEWS) {
    await page.keyboard.press("Tab");
    await expect(system.getByRole("link", { name })).toBeFocused();
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
  await page.goto("/system/routes-and-spend");
  // A keypress before the shell has drawn is spent on nothing, so wait for the screen first.
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  await skipLinkReachesTheScreen(page);
});

test("scrolls nothing sideways at 320 pixels, navigation open or closed", async ({
  page,
  request,
}) => {
  await signedIn(page, request, "Acme Joinery");
  await page.setViewportSize(NARROW);
  await page.goto("/system/routes-and-spend");
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

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
  await page.goto("/system/routes-and-spend");

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
 * The view's read of the routes is issued after the nav paints, so a screen here has not
 * finished starting until its card lists them.
 */
const theRoutesHaveLanded = (page: Page) =>
  expect(routesCardOf(page).getByRole("list")).toHaveCount(1);

test("fills the toolbar with tabs the arrow keys move between", async ({ page, request }) => {
  await signedIn(page, request, "Calder Ironworks");
  await page.goto("/system/routes-and-spend");

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

test("draws no toolbar over a view without tabs or acts", async ({ page, request }) => {
  await signedIn(page, request, "Airedale Presswork");
  await page.goto("/system/health");
  await expect(page.getByRole("heading", { level: 2, name: "Health" })).toBeVisible();

  await expect(page.getByRole("tablist")).toHaveCount(0);

  /** An empty bar is what this forbids, so the content must follow the top bar itself. */
  const met = await page.evaluate(
    () => document.querySelector("header")?.nextElementSibling === document.querySelector("main"),
  );
  expect(met).toBe(true);
});

test("tabs to the toolbar between the top bar and content", async ({ page, request }) => {
  const workspace = await signedIn(page, request, "Wensleydale Precision");
  await page.goto("/system/routes-and-spend");
  await expect(routesCardOf(page).getByRole("listitem")).toHaveCount(5);

  // The order down to the top bar is another test's; starting at its last stop proves this
  // claim without proving that one twice.
  await page
    .getByRole("banner")
    .getByRole("button", { name: new RegExp(workspace.admin.name) })
    .focus();

  await page.keyboard.press("Tab");
  await expect(tabsOf(page).getByRole("tab", { name: "Routes" })).toBeFocused();

  // The open tab's panel holds the view, so the content is reached through the toolbar.
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
  await page.goto("/system/routes-and-spend");

  const nav = navOf(page, "System");
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
  await page.goto("/system/routes-and-spend");
  await expect(navOf(page, "System")).toBeVisible();
  await theRoutesHaveLanded(page);

  // Listening only across the act, so neither the start above nor the reload below is mistaken
  // for it.
  const asked: string[] = [];
  const noting = (each: { url: () => string }) => asked.push(each.url());
  page.on("request", noting);
  await closerOf(page).click();
  await expect(navOf(page, "System")).toHaveCount(0);
  page.off("request", noting);
  expect(asked).toEqual([]);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  await expect(navOf(page, "System")).toHaveCount(0);
  await expect(openerOf(page)).toBeVisible();

  const kept = await keptOnThisBrowser(page);
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatch(/ (open|closed)$/);
  for (const secret of [
    workspace.admin.email,
    workspace.admin.name,
    workspace.admin.id,
    workspace.workspaceId,
  ]) {
    expect(kept[0]).not.toContain(secret);
  }
});

test("opens the navigation over narrow content, holding and returning focus", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await signedIn(page, request, "Wharfedale Castings");
  await page.setViewportSize(NARROW);
  await page.goto("/system/routes-and-spend");
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  await expect(railOf(page)).toHaveCount(0);
  await expect(navOf(page, "System")).toHaveCount(0);
  const contentWide = await widthOf(page.getByRole("main"));

  const menu = menuOf(page);
  await menu.click();
  const panel = panelOf(page);
  await expect(panel.getByRole("navigation", { name: "Control Centre" })).toBeVisible();
  await expect(panel.getByRole("navigation", { name: "System" })).toBeVisible();
  await expect(panel.getByRole("link")).toHaveText([...SCREEN_NAMES, ...SYSTEM_VIEWS]);

  // Over the content, not beside it: the content keeps every pixel it had.
  expect(await widthOf(page.getByRole("main"))).toBe(contentWide);

  /**
   * Twice round every stop it holds — the destinations and its way out — so a reader behind
   * it can never tab onto the screen.
   */
  const stops = SCREEN_NAMES.length + SYSTEM_VIEWS.length + 1;
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
  await page.goto("/system/routes-and-spend");
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  const menu = menuOf(page);
  await menu.click();
  await panelOf(page).getByRole("link", { name: "Health" }).click();

  await expect(panelOf(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Health" })).toBeVisible();
  await expect(menu).toBeFocused();

  await menu.click();
  await panelOf(page).getByRole("link", { name: "People" }).click();

  await expect(panelOf(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
});

test("closes Screens and views on widening, focusing the navigation control", async ({
  page,
  request,
}) => {
  await signedIn(page, request, "Calder Pressings");
  await page.setViewportSize(NARROW);
  await page.goto("/system/routes-and-spend");
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  await menuOf(page).click();
  await expect(panelOf(page)).toBeVisible();

  // The reader never asked for this crossing, so the sheet owes back the focus it borrowed —
  // vanishing would leave it on the body.
  await page.setViewportSize(WIDE);

  await expect(panelOf(page)).toHaveCount(0);
  await expect(railOf(page)).toBeVisible();
  await expect(navOf(page, "System")).toBeVisible();
  await expect(closerOf(page)).toBeFocused();
});
