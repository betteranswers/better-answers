import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";

import { anAddress, provision, signIn, skipLinkReachesTheScreen } from "./harness.ts";

const SCREEN_NAMES = ["Sources", "Suggestions", "Knowledge", "Questions", "People", "System"];

const SYSTEM_VIEWS = ["Signals", "Health", "Routes and spend", "Backups"];

const SWAP_BUDGET_MS = 1000;

const NARROW = { width: 320, height: 720 };

const railOf = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const topOf = async (region: Locator): Promise<number> =>
  (await region.boundingBox())?.y ?? Number.NaN;

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

test("the icon rail reaches each of the six screens, named to the eye, the pointer and the keyboard", async ({
  page,
  request,
}) => {
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

test("the rail marks the screen being read, announced and drawn, and never two at once", async ({
  page,
  request,
}) => {
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

test("the secondary nav lists the open screen's views, marks the one being read and swaps on a change of screen", async ({
  page,
  request,
}) => {
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

test("the top bar names the workspace, then where the person is, then who they are and their role", async ({
  page,
  request,
}) => {
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

test("the keyboard order is the skip link, the rail, the secondary nav, the top bar, the screen", async ({
  page,
  request,
}) => {
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

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("banner").getByRole("button", { name: new RegExp(workspace.admin.name) }),
  ).toBeFocused();

  // Nothing carries a positive tabindex, so the document's own order is the tab order and
  // the screen comes last.
  const contentIsLast = await page.evaluate(() => {
    const bar = document.querySelector("header");
    const content = document.querySelector("main");
    if (bar === null || content === null) return false;
    const following = bar.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING;
    return following !== 0 && document.querySelector("[tabindex]:not([tabindex='-1'])") === null;
  });
  expect(contentIsLast).toBe(true);
});

// Its own test, not the tail of the one above: the skip link is the first stop, so it needs
// a screen with nothing focused.
test("the skip link moves focus into the content, not back into the navigation", async ({
  page,
  request,
}) => {
  await signedIn(page, request, "Ribble Toolmaking");
  await page.goto("/system/routes-and-spend");
  // A keypress before the shell has drawn is spent on nothing, so wait for the screen first.
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  await skipLinkReachesTheScreen(page);
});

test("a screen at 320 pixels stacks the regions and scrolls nothing sideways", async ({
  page,
  request,
}) => {
  await signedIn(page, request, "Acme Joinery");
  await page.setViewportSize(NARROW);
  await page.goto("/system/routes-and-spend");
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  const rail = await topOf(railOf(page));
  const nav = await topOf(page.getByRole("navigation", { name: "System" }));
  const bar = await topOf(page.getByRole("banner"));
  const content = await topOf(page.getByRole("main"));
  expect(rail).toBeLessThan(nav);
  expect(nav).toBeLessThan(bar);
  expect(bar).toBeLessThan(content);

  const room = await page.evaluate(() => ({
    scrolls: document.documentElement.scrollWidth,
    holds: document.documentElement.clientWidth,
  }));
  expect(room.scrolls).toBeLessThanOrEqual(room.holds);
});

test("the shell is painted in the page's own token, so a screen sits on the product's surface", async ({
  page,
  request,
}) => {
  await signedIn(page, request, "Southern Castings");
  await page.goto("/system/routes-and-spend");

  const painted = await page.locator("main").evaluate((main) => {
    const nothing = "rgba(0, 0, 0, 0)";
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--surface-page)";
    document.body.append(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();

    // The first painted ancestor is what a reader sees behind the screen, whatever the number
    // of layout wrappers between.
    let behind = main.parentElement;
    while (behind !== null && getComputedStyle(behind).backgroundColor === nothing) {
      behind = behind.parentElement;
    }
    return { behind: behind === null ? nothing : getComputedStyle(behind).backgroundColor, token };
  });
  expect(painted.token).not.toBe("rgba(0, 0, 0, 0)");
  expect(painted.behind).toBe(painted.token);
});
