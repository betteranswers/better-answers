import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  markTheOperator,
  person,
  provision,
  signedInAtHome,
  signIn,
  skipLinkReachesTheScreen,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const WORKSPACES_VIEW = "/console/workspaces/every-workspace";

const CLOSED = "The console is the operator's alone";

const UK_DAY =
  /^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;

const railOf = (page: Page) => page.getByRole("navigation", { name: "Console" });

const menuOf = (page: Page, who: string) =>
  page.getByRole("banner").getByRole("button", { name: new RegExp(who) });

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
  test("offers the operator the console from the top bar's menu", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const workspace = await theOperator(page, request, "Wharfedale Castings");

    await menuOf(page, workspace.admin.name).click();
    const theConsole = page.getByRole("menuitem", { name: "Console" });
    await expect(theConsole).toBeVisible();
    await passesTheAccessibilityGate();
    await theConsole.click();

    await expect(page).toHaveURL(WORKSPACES_VIEW);
    const bar = page.getByRole("banner");
    await expect(bar.getByText("Console", { exact: true })).toBeVisible();
    await expect(bar.getByText(workspace.name)).toHaveCount(0);
    await expect(railOf(page).getByRole("link")).toHaveText(["People", "Workspaces"]);
    await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);

    const you = menuOf(page, workspace.admin.name);
    await expect(you).not.toContainText("Admin");
  });

  test("offers no console to a person without the mark", async ({ page, request }) => {
    const workspace = await anAdmin(page, request, "Pennine Metalwork");

    await menuOf(page, workspace.admin.name).click();

    await expect(page.getByRole("menuitem")).toHaveText(["Sign out"]);
  });

  test("shows a non-operator the refused state at /console", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdmin(page, request, "Calder Ironworks");

    await page.goto("/console");

    await expect(page.getByRole("heading", { level: 1, name: CLOSED })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(
      "Refused: not-the-operator. Only the operator may open the console. Go back to your workspaces.",
    );
    await expect(railOf(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Back to your workspaces" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  });

  test("sends a signed-out operator to sign in, then back", async ({ page, request }) => {
    const email = anAddress("operator");
    await provision(request, { name: "Airedale Presswork", adminEmail: email });
    await markTheOperator(request, email);

    await page.goto("/console");
    await expect(page).toHaveURL("/sign-in?redirect=%2Fconsole");
    await signIn(page, request, email);

    await expect(page).toHaveURL(WORKSPACES_VIEW);
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
  });

  test("links the operator back to the workspace picker", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Ribble Toolmaking");
    const second = await provision(request, { name: "Calder Pattern Works" });
    await addMember(request, {
      workspaceId: second.workspaceId,
      userId: workspace.admin.id,
      role: "Viewer",
    });
    await page.goto("/console");

    await menuOf(page, workspace.admin.name).click();
    await page.getByRole("menuitem", { name: "Back to your workspaces" }).click();

    await expect(page).toHaveURL("/choose-workspace");
    await expect(page.getByRole("heading", { level: 1, name: "Choose a workspace" })).toBeVisible();
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

    await page.goto(WORKSPACES_VIEW);

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
    await page.goto(WORKSPACES_VIEW);
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
    await page.goto(WORKSPACES_VIEW);
    await expect(itemOf(page, workspace.name)).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "workspaces list", description: `${elapsed} ms` });
    expect(elapsed, "the workspaces list took longer than its second").toBeLessThan(LIST_BUDGET_MS);
  });

  test("the list shows the api's refusal once the mark clears", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Calder Pressings");
    await page.goto(WORKSPACES_VIEW);
    await expect(itemOf(page, workspace.name)).toBeVisible();

    await markTheOperator(request, workspace.admin.email, "revoke");
    // A move between the console's own screens keeps its standing, so the list asks again alone.
    await railOf(page).getByRole("link", { name: "People" }).click();
    await railOf(page).getByRole("link", { name: "Workspaces" }).click();

    await expect(listOf(page)).toContainText(
      "Refused: not-the-operator. Only the operator may open the console. Go back to your workspaces.",
    );
    await expect(listOf(page).getByRole("listitem")).toHaveCount(0);
  });

  test("closes the console on entry once the mark is cleared", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Rossendale Forge");
    // The menu offers the console from the standing the page read before the mark was cleared.
    await menuOf(page, workspace.admin.name).click();
    const theConsole = page.getByRole("menuitem", { name: "Console" });
    await expect(theConsole).toBeVisible();

    await markTheOperator(request, workspace.admin.email, "revoke");
    await theConsole.click();

    await expect(page.getByRole("heading", { level: 1, name: CLOSED })).toBeVisible();
    await expect(railOf(page)).toHaveCount(0);
  });

  test("opens People on Everyone, and Names waiting is unbuilt", async ({ page, request }) => {
    await theOperator(page, request, "Halifax Fabrication");
    await page.goto(WORKSPACES_VIEW);

    await railOf(page).getByRole("link", { name: "People" }).click();

    await expect(page).toHaveURL("/console/people/everyone");
    await expect(page.getByRole("region", { name: "Everyone" })).toBeVisible();
    const views = page.getByRole("navigation", { name: "People" }).getByRole("link");
    await expect(views).toHaveText(["Everyone", "Names waiting"]);
    await views.filter({ hasText: "Names waiting" }).click();
    await expect(page.getByText("This view is not built yet.")).toBeVisible();
  });

  test("keeps the console's regions on an address it lacks", async ({ page, request }) => {
    await theOperator(page, request, "Northern Tooling");

    await page.goto("/console/not-a-screen");

    await expect(page.getByRole("heading", { level: 1, name: "No such screen" })).toBeVisible();
    await expect(page.getByText("not one of the console's screens")).toBeVisible();
    await expect(railOf(page)).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Workspaces" })).toHaveAttribute(
      "href",
      "/console/workspaces",
    );
  });

  test("scrolls nothing sideways at 320 pixels", async ({ page, request }) => {
    await theOperator(page, request, "Acme Joinery");
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(WORKSPACES_VIEW);
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
    await page.goto(WORKSPACES_VIEW);
    const ours = itemOf(page, workspace.name);
    await expect(ours).toBeVisible();

    await skipLinkReachesTheScreen(page);

    // Back to the first stop, to walk the regions in the order the document gives them.
    await page.getByRole("link", { name: "Skip to the screen" }).focus();
    for (const name of ["People", "Workspaces"]) {
      await page.keyboard.press("Tab");
      await expect(railOf(page).getByRole("link", { name })).toBeFocused();
    }
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Every workspace" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Hide the secondary nav" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(menuOf(page, workspace.admin.name)).toBeFocused();

    await expect(railOf(page)).toMatchAriaSnapshot(`
      - navigation "Console":
        - list:
          - listitem:
            - link "People"
          - listitem:
            - link "Workspaces"
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
