import type { APIRequestContext, Page } from "@playwright/test";

import {
  ALL_WORKSPACES,
  BREADCRUMB,
  goHome,
  JUMP_TO,
  RAIL,
  TOGGLE,
  UNKNOWN_SCREEN,
} from "@/app/words.ts";
import { PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { NOT_THE_OPERATOR, ONLY_THE_OPERATOR } from "@/features/console/refusal-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { CONSOLE, HOMES } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  landedAtHome,
  markTheOperator,
  person,
  personMenuOpened,
  provision,
  signedInAtHome,
  signIn,
  skipLinkReachesTheScreen,
  switcherOf,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const EVERY_WORKSPACE = HOMES.operator.path;

const CLOSED = "The console is the operator's alone";

const UK_DAY =
  /^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;

const railOf = (page: Page) => page.getByRole("navigation", { name: RAIL });

const navOf = (page: Page) => page.getByRole("navigation", { name: CONSOLE.name });

const menuOf = (page: Page, who: string) =>
  page.getByRole("banner").getByRole("button", { name: new RegExp(who) });

const switcherMenuOf = (page: Page, here: string) => page.getByRole("menu", { name: here });

/** The way in is the switcher's, offered from the operator's standing as last read. */
const theConsoleOffered = async (page: Page, workspaceName: string) => {
  await switcherOf(page, workspaceName).click();
  const theConsole = switcherMenuOf(page, workspaceName).getByRole("menuitem", {
    name: CONSOLE.name,
  });
  await expect(theConsole).toBeVisible();
  return theConsole;
};

const crumbOf = (page: Page, name: string) =>
  page
    .getByRole("banner")
    .getByRole("navigation", { name: BREADCRUMB })
    .getByRole("link", { name, exact: true });

const listOf = (page: Page) => page.getByRole("region", { name: "Every workspace" });

const itemOf = (page: Page, name: string) =>
  listOf(page).getByRole("listitem", { name, exact: true });

/**
 * The console lists every workspace the run provisioned, so a name another spec also uses would
 * match two rows.
 */
const aNameOfItsOwn = (name: string): string =>
  `${name} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const theOperator = async (page: Page, api: APIRequestContext, workspaceName: string) => {
  const email = anAddress("operator");
  const workspace = await provision(api, {
    name: aNameOfItsOwn(workspaceName),
    adminEmail: email,
  });
  await markTheOperator(api, email);
  await signedInAtHome(page, api, email);
  return workspace;
};

const anAdmin = async (page: Page, api: APIRequestContext, workspaceName: string) => {
  const email = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: email });
  await signedInAtHome(page, api, email);
  return workspace;
};

test.describe("the way into the console", () => {
  test("offers the operator the console from the workspace switcher", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const workspace = await theOperator(page, request, "Wharfedale Castings");

    const theConsole = await theConsoleOffered(page, workspace.name);
    await passesTheAccessibilityGate();
    await theConsole.click();

    await expect(page).toHaveURL(EVERY_WORKSPACE);
    const bar = page.getByRole("banner");
    await expect(switcherOf(page, CONSOLE.name)).toBeVisible();
    await expect(bar.getByText(workspace.name)).toHaveCount(0);
    await expect(bar.getByRole("link", { name: PRODUCT_NAME })).toHaveAttribute(
      "href",
      EVERY_WORKSPACE,
    );
    await expect(railOf(page).getByRole("link")).toHaveText([CONSOLE.name]);
    await expect(navOf(page).getByRole("link")).toHaveText([
      "Everyone",
      "Names waiting",
      "Every workspace",
    ]);
    await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);

    const you = await personMenuOpened(page, workspace.admin.name);
    await expect(you.getByText(workspace.admin.name, { exact: true })).toBeVisible();
    await expect(you).not.toContainText("Admin");
    await expect(you.getByRole("menuitem")).toHaveText(["Sign out"]);
  });

  test("offers no console to a person without the mark", async ({ page, request }) => {
    const workspace = await anAdmin(page, request, "Pennine Metalwork");

    await switcherOf(page, workspace.name).click();
    const menu = switcherMenuOf(page, workspace.name);
    await expect(menu.getByRole("menuitemradio")).toHaveText([workspace.name]);
    await expect(menu.getByRole("menuitem")).toHaveText([ALL_WORKSPACES]);
    await page.keyboard.press("Escape");

    const you = await personMenuOpened(page, workspace.admin.name);
    await expect(you.getByRole("menuitem")).toHaveText(["Sign out"]);
  });

  test("shows a non-operator the refused state at /console", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdmin(page, request, "Calder Ironworks");

    await page.goto("/console");

    await expect(page.getByRole("heading", { level: 1, name: CLOSED })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(sentenceOf(ONLY_THE_OPERATOR));
    await expect(page.locator("body")).not.toContainText(NOT_THE_OPERATOR);
    await expect(railOf(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Back to your workspaces" })).toBeFocused();
    await page.keyboard.press("Enter");
    await landedAtHome(page, "Admin");
  });

  test("sends a signed-out operator to sign in, then back", async ({ page, request }) => {
    const email = anAddress("operator");
    await provision(request, { name: "Airedale Presswork", adminEmail: email });
    await markTheOperator(request, email);

    await page.goto("/console");
    await expect(page).toHaveURL("/sign-in?redirect=%2Fconsole");
    await signIn(page, request, email);

    await expect(page).toHaveURL(EVERY_WORKSPACE);
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
  });

  test("lists the operator's workspaces from the console's switcher", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const workspace = await theOperator(page, request, "Ribble Toolmaking");
    const second = await provision(request, { name: "Calder Pattern Works" });
    await addMember(request, {
      workspaceId: second.workspaceId,
      userId: workspace.admin.id,
      role: "Viewer",
    });
    await page.goto("/console");

    await switcherOf(page, CONSOLE.name).click();
    const menu = switcherMenuOf(page, CONSOLE.name);
    // No workspace is open in the console, so the list reads in name order alone.
    await expect(menu.getByRole("menuitemradio")).toHaveText([second.name, workspace.name]);
    await expect(menu.getByRole("menuitem")).toHaveText([ALL_WORKSPACES]);
    await passesTheAccessibilityGate();

    await menu.getByRole("menuitemradio", { name: second.name }).click();
    await landedAtHome(page, "Viewer");
    await expect(switcherOf(page, second.name)).toBeVisible();

    await switcherOf(page, second.name).click();
    await switcherMenuOf(page, second.name).getByRole("menuitem", { name: ALL_WORKSPACES }).click();
    await expect(page).toHaveURL("/choose-workspace");
    await expect(page.getByRole("heading", { level: 1, name: PICKER_WORDS.heading })).toBeVisible();
  });
});

test.describe("the console's Workspaces screen", () => {
  test("lists each workspace with its slug, members and provisioning day", async ({
    page,
    request,
  }) => {
    const workspace = await theOperator(page, request, "Dales Engineering");
    const acme = await provision(request, { name: aNameOfItsOwn("Acme Holdings") });
    const colleague = await person(request, anAddress("colleague"));
    await addMember(request, {
      workspaceId: acme.workspaceId,
      userId: colleague.id,
      role: "Editor",
    });

    await page.goto(EVERY_WORKSPACE);

    const theirs = itemOf(page, acme.name);
    await expect(theirs.getByText("2 members", { exact: true })).toBeVisible();
    await expect(theirs.getByRole("definition").first()).toHaveText(acme.slug);
    await expect(theirs.getByRole("definition").nth(1)).toHaveText(UK_DAY);
    await expect(itemOf(page, workspace.name).getByText("1 member", { exact: true })).toBeVisible();

    await theirs.getByRole("button", { name: `More about ${acme.name}` }).click();
    await expect(theirs.getByText(acme.workspaceId, { exact: true })).toBeVisible();
  });

  test("carries no control that provisions, renames or removes a workspace", async ({
    page,
    request,
  }) => {
    const workspace = await theOperator(page, request, "Southern Castings");
    await page.goto(EVERY_WORKSPACE);
    await expect(itemOf(page, workspace.name)).toBeVisible();

    const list = listOf(page);
    await expect(list.getByRole("textbox")).toHaveCount(0);
    await expect(list.getByRole("combobox")).toHaveCount(0);
    await expect(list.getByRole("checkbox")).toHaveCount(0);
    await expect(list.getByRole("link")).toHaveCount(0);
    const buttons = await list.getByRole("button").allTextContents();
    expect(buttons.every((name) => name.startsWith("More about "))).toBe(true);
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Wensleydale Precision");

    const started = Date.now();
    await page.goto(EVERY_WORKSPACE);
    await expect(itemOf(page, workspace.name)).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "workspaces list", description: `${elapsed} ms` });
    expect(elapsed, "the workspaces list took longer than its second").toBeLessThan(LIST_BUDGET_MS);
  });

  test("says who may read the list once the mark clears", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Calder Pressings");
    await page.goto(EVERY_WORKSPACE);
    await expect(itemOf(page, workspace.name)).toBeVisible();

    await markTheOperator(request, workspace.admin.email, "revoke");
    // A move between the console's own screens keeps its standing, so the list asks again alone.
    await navOf(page).getByRole("link", { name: "Everyone" }).click();
    await navOf(page).getByRole("link", { name: "Every workspace" }).click();

    await expect(listOf(page)).toContainText(sentenceOf(ONLY_THE_OPERATOR));
    await expect(listOf(page)).not.toContainText(NOT_THE_OPERATOR);
    await expect(listOf(page).getByRole("listitem")).toHaveCount(0);
  });

  test("closes the console on entry once the mark is cleared", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Rossendale Forge");
    // Offered from the standing read before the mark was cleared.
    const theConsole = await theConsoleOffered(page, workspace.name);

    await markTheOperator(request, workspace.admin.email, "revoke");
    await theConsole.click();

    await expect(page.getByRole("heading", { level: 1, name: CLOSED })).toBeVisible();
    await expect(railOf(page)).toHaveCount(0);
  });

  test("opens People on Everyone, with Names waiting beside it", async ({ page, request }) => {
    await theOperator(page, request, "Halifax Fabrication");
    await page.goto(EVERY_WORKSPACE);

    await page.goto("/console/people");

    await expect(page).toHaveURL("/console/people/everyone");
    await expect(page.getByRole("region", { name: "Everyone" })).toBeVisible();
    const screens = navOf(page).getByRole("link");
    await expect(screens).toHaveText(["Everyone", "Names waiting", "Every workspace"]);
    await screens.filter({ hasText: "Names waiting" }).click();
    await expect(page).toHaveURL("/console/people/names-waiting");
    await expect(page.getByRole("region", { name: "Names waiting" })).toBeVisible();
  });

  test("keeps the console's regions on an address it lacks", async ({ page, request }) => {
    await theOperator(page, request, "Northern Tooling");

    await page.goto("/console/not-a-screen");

    await expect(
      page.getByRole("heading", { level: 1, name: UNKNOWN_SCREEN.heading }),
    ).toBeVisible();
    await expect(railOf(page)).toBeVisible();
    await expect(page.getByRole("link", { name: goHome(HOMES.operator) })).toHaveAttribute(
      "href",
      HOMES.operator.path,
    );
  });

  test("scrolls nothing sideways at 320 pixels", async ({ page, request }) => {
    await theOperator(page, request, "Acme Joinery");
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(EVERY_WORKSPACE);
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();

    const room = await page.evaluate(() => ({
      scrolls: document.documentElement.scrollWidth,
      holds: document.documentElement.clientWidth,
    }));
    expect(room.scrolls).toBeLessThanOrEqual(room.holds);
  });

  test("is keyboard-operable, sounds like a list and passes axe", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const workspace = await theOperator(page, request, "Pendle Toolworks");
    await page.goto(EVERY_WORKSPACE);
    const ours = itemOf(page, workspace.name);
    await expect(ours).toBeVisible();

    await skipLinkReachesTheScreen(page);

    // Back to the first stop, to walk the regions in the order the document gives them.
    await page.getByRole("link", { name: "Skip to the screen" }).focus();
    for (const stop of [
      page.getByRole("banner").getByRole("link", { name: PRODUCT_NAME }),
      switcherOf(page, CONSOLE.name),
      page.getByRole("button", { name: TOGGLE.hide }),
      crumbOf(page, CONSOLE.name),
      crumbOf(page, "Workspaces"),
      page.getByRole("banner").getByRole("button", { name: JUMP_TO.name }),
      menuOf(page, workspace.admin.name),
      railOf(page).getByRole("link", { name: CONSOLE.name }),
      railOf(page).getByRole("button", { name: KEYSTROKE_WORDS.button }),
    ]) {
      await page.keyboard.press("Tab");
      await expect(stop).toBeFocused();
    }
    for (const name of ["Everyone", "Names waiting", "Every workspace"]) {
      await page.keyboard.press("Tab");
      await expect(navOf(page).getByRole("link", { name })).toBeFocused();
    }

    await expect(railOf(page)).toMatchAriaSnapshot(`
      - navigation "${RAIL}":
        - list:
          - listitem:
            - link "${CONSOLE.name}"
        - button "${KEYSTROKE_WORDS.button}"
    `);
    await expect(ours).toMatchAriaSnapshot(`
      - listitem "${workspace.name}":
        - heading "${workspace.name}" [level=3]
        - text: 1 member
        - term: Slug
        - definition:
          - code: ${workspace.slug}
        - term: Provisioned
        - definition: /\\d{1,2} [A-Z][a-z]+ \\d{4}/
        - button "More about ${workspace.name}"
    `);

    await passesTheAccessibilityGate();

    const more = ours.getByRole("button", { name: `More about ${workspace.name}` });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(ours.getByText(workspace.workspaceId, { exact: true })).toBeVisible();
  });
});
