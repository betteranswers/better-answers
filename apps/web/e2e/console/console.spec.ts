import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { WORKSPACES_KEYSTROKES } from "@/features/console/people-keystrokes.ts";
import { NOT_THE_OPERATOR } from "@/features/console/refusal-words.ts";
import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  allWorkspacesPicked,
  anAddress,
  avatarOf,
  crumbOf,
  keyShown,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  markTheOperator,
  navOf,
  person,
  personMenuOpened,
  provision,
  railOf,
  saysARefusal,
  saysOfItsRead,
  signedInAtHome,
  signIn,
  signInByEmail,
  skipLinkReachesThePage,
  switcherMenuOf,
  switcherOf,
  withAnAuthenticator,
} from "../harness.ts";
import { refusalAnswering, refusedFromNowOn } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

const EVERY_WORKSPACE = HOMES.operator.path;

const controlCentreMenu = (page: Page) => navOf(page, "Control Centre");

const noWorkspaceYet = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No Workspace Yet" });

const CLOSED = "Access Denied";

const theConsoleOffered = async (page: Page, workspaceName: string) => {
  await switcherOf(page, workspaceName).click();
  const theConsole = switcherMenuOf(page, workspaceName).getByRole("menuitem", {
    name: "Console",
  });
  await expect(theConsole).toBeVisible();
  return theConsole;
};

const listedAs = (name: string, role: "Admin" | "Viewer"): string => `${name} ${role}`;

const listOf = (page: Page) => page.getByRole("region", { name: "Every Workspace" });

const searchOf = (page: Page) =>
  listOf(page).getByRole("searchbox", { name: "Search by name or short name" });

const countOf = (page: Page) => listOf(page).getByRole("status");

const workspaceRows = (page: Page): Locator =>
  listOf(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator =>
  workspaceRows(page).filter({
    has: page.getByRole("button", { name: `More About ${name}`, exact: true }),
  });

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
    await expect(switcherOf(page, "Console")).toBeVisible();
    await expect(bar.getByText(workspace.name)).toHaveCount(0);
    await expect(bar.getByRole("link", { name: "better-answers" })).toHaveAttribute(
      "href",
      EVERY_WORKSPACE,
    );
    await expect(railOf(page).getByRole("link")).toHaveText(["Console"]);
    await expect(navOf(page, "Console").getByRole("link")).toHaveText([
      "Everyone",
      "Names Waiting",
      "Every Workspace",
    ]);
    await expect(controlCentreMenu(page)).toHaveCount(0);

    const you = await personMenuOpened(page, workspace.admin.name);
    await expect(you.getByText(workspace.admin.name, { exact: true })).toBeVisible();
    await expect(you).not.toContainText("Admin");
    await expect(you.getByRole("menuitem")).toHaveText(["Account", "Sign Out"]);
  });

  test("offers no console to a person without the mark", async ({ page, request }) => {
    const workspace = await anAdmin(page, request, "Pennine Metalwork");

    await switcherOf(page, workspace.name).click();
    const menu = switcherMenuOf(page, workspace.name);
    await expect(menu.getByRole("menuitemradio")).toHaveText([listedAs(workspace.name, "Admin")]);
    await expect(menu.getByRole("menuitem")).toHaveText(["All Workspaces"]);
    await page.keyboard.press("Escape");

    const you = await personMenuOpened(page, workspace.admin.name);
    await expect(you.getByRole("menuitem")).toHaveText(["Account", "Sign Out"]);
  });

  test("shows a non-operator the refused state at /console", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdmin(page, request, "Calder Ironworks");

    await page.goto("/console");

    await expect(page.getByRole("heading", { level: 1, name: CLOSED })).toBeVisible();
    await saysARefusal(page.getByRole("alert"));
    await expect(page.locator("body")).not.toContainText(NOT_THE_OPERATOR);
    await expect(railOf(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Back to Your Workspaces" })).toBeFocused();
    await page.keyboard.press("Enter");
    await landedAtHome(page, "Admin");
    await expect(controlCentreMenu(page)).toBeVisible();
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

  test("sends a no-workspace operator to the console after setup", async ({ page, request }) => {
    const email = anAddress("operator");
    await person(request, email);
    await markTheOperator(request, email);
    await page.goto("/sign-in");
    await signInByEmail(page, request, email);

    await page.getByRole("button", { name: "Set Up an Authenticator Instead" }).click();
    const key = await keyShown(page);
    await page.getByLabel("Authenticator Code").fill(authenticatorCodeAt(key, new Date()));
    await page.getByRole("checkbox", { name: "I have saved these codes" }).check();
    await page.getByRole("button", { name: "Finish Setup" }).click();

    await expect(page).toHaveURL(EVERY_WORKSPACE);
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    await expect(switcherOf(page, "Console")).toBeVisible();
  });

  test("sends no-workspace operators to the console at sign-in and /", async ({
    page,
    request,
  }) => {
    const email = anAddress("operator");
    await person(request, email);
    await markTheOperator(request, email);
    await withAnAuthenticator(request, email);
    await page.goto("/sign-in");
    await signIn(page, request, email);

    await expect(page).toHaveURL(EVERY_WORKSPACE);
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();

    await page.goto("/");
    await expect(page).toHaveURL(EVERY_WORKSPACE);
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    await expect(noWorkspaceYet(page)).toHaveCount(0);
  });

  test("shows a non-operator with no workspace No Workspace Yet", async ({ page, request }) => {
    const email = anAddress("person");
    await person(request, email);
    await page.goto("/sign-in");
    await signIn(page, request, email);

    await page.goto("/");
    await expect(noWorkspaceYet(page)).toBeVisible();
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

    await switcherOf(page, "Console").click();
    const menu = switcherMenuOf(page, "Console");
    await expect(menu.getByRole("menuitemradio")).toHaveText([
      listedAs(second.name, "Viewer"),
      listedAs(workspace.name, "Admin"),
    ]);
    await expect(menu.getByRole("menuitem")).toHaveText(["All Workspaces"]);
    await passesTheAccessibilityGate();

    await menu.getByRole("menuitemradio", { name: second.name }).click();
    await landedAtHome(page, "Viewer");
    await expect(switcherOf(page, second.name)).toBeVisible();

    await allWorkspacesPicked(page, second.name);
    await expect(page).toHaveURL("/choose-workspace");
    await expect(page.getByRole("heading", { level: 1, name: "Your Workspaces" })).toBeVisible();
  });
});

test.describe("the console's Workspaces page", () => {
  test("narrows by name or short name, saying when none match", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const workspace = await theOperator(page, request, "Ribble Castings");
    const other = await provision(request, { name: aNameOfItsOwn("Lune Bindery") });
    await page.goto(EVERY_WORKSPACE);
    await expect(rowOf(page, other.name)).toBeVisible();

    const listed = await keystrokesListed(page, "Every Workspace");
    await expect(listed.getByRole("definition")).toHaveText([
      "Search Every Workspace by Name or Short Name",
      "Show This List",
      "Jump To",
    ]);
    await keystrokesDismissed(page, listed);

    const shouted = workspace.name.toUpperCase();
    await page.keyboard.press(WORKSPACES_KEYSTROKES.search.key);
    await expect(searchOf(page)).toBeFocused();
    await page.keyboard.type(shouted);
    await expect(workspaceRows(page)).toHaveCount(1);
    await expect(rowOf(page, workspace.name)).toBeVisible();
    await expect(countOf(page)).toHaveText(/\b1\b/);

    await searchOf(page).fill(other.shortName);
    await expect(workspaceRows(page)).toHaveCount(1);
    await expect(rowOf(page, other.name)).toBeVisible();

    const nowhere = `nowhere ${workspace.shortName}`;
    await searchOf(page).fill(nowhere);
    await expect(countOf(page)).toHaveText(/\b0\b/);
    await expect(rowOf(page, workspace.name)).toHaveCount(0);
    await expect(rowOf(page, other.name)).toHaveCount(0);
    await passesTheAccessibilityGate();
    await listOf(page).getByRole("button", { name: "Clear Search" }).click();

    await expect(searchOf(page)).toHaveValue("");
    await expect(searchOf(page)).toBeFocused();
    await expect(rowOf(page, workspace.name)).toBeVisible();
    await expect(rowOf(page, other.name)).toBeVisible();
  });

  test("carries no control that provisions, renames or removes a workspace", async ({
    page,
    request,
  }) => {
    const workspace = await theOperator(page, request, "Southern Castings");
    await page.goto(EVERY_WORKSPACE);
    await expect(rowOf(page, workspace.name)).toBeVisible();

    const list = listOf(page);
    await expect(list.getByRole("searchbox"), "the one field narrows the rows").toHaveCount(1);
    await expect(list.getByRole("textbox")).toHaveCount(0);
    await expect(list.getByRole("combobox")).toHaveCount(0);
    await expect(list.getByRole("checkbox")).toHaveCount(0);
    await expect(list.getByRole("link")).toHaveCount(0);
    const buttons = await list.getByRole("button").allTextContents();
    expect(
      buttons.filter((name) => !name.startsWith("More About ")),
      "a button other than a row's disclosure and the column menu",
    ).toEqual(["Columns"]);
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Wensleydale Precision");

    const started = Date.now();
    await page.goto(EVERY_WORKSPACE);
    await expect(rowOf(page, workspace.name)).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "workspaces list", description: `${elapsed} ms` });
    expect(elapsed, "the workspaces list took longer than its second").toBeLessThan(LIST_BUDGET_MS);
  });

  test("takes the list away once the mark clears", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Calder Pressings");
    await page.goto(EVERY_WORKSPACE);
    await expect(rowOf(page, workspace.name)).toBeVisible();

    await markTheOperator(request, workspace.admin.email, "revoke");
    await navOf(page, "Console").getByRole("link", { name: "Everyone" }).click();
    const refused = refusalAnswering(page, "console.workspaces.list");
    await navOf(page, "Console").getByRole("link", { name: "Every Workspace" }).click();

    expect(await refused).toMatchObject({ word: NOT_THE_OPERATOR, class: "forbidden" });
    await expect(listOf(page)).not.toContainText(NOT_THE_OPERATOR);
    await expect(listOf(page).getByRole("table")).toHaveCount(0);
    await saysOfItsRead(listOf(page));
  });

  test("keeps Every workspace's search and focus through a refused re-read", async ({
    page,
    context,
    request,
  }) => {
    await theOperator(page, request, "Colne Pressings");
    await page.goto(EVERY_WORKSPACE);
    await expect(listOf(page).getByRole("table")).toBeVisible();
    await searchOf(page).fill("colne");
    await expect(searchOf(page)).toBeFocused();

    await refusedFromNowOn(page, "console.workspaces.list");
    const refused = refusalAnswering(page, "console.workspaces.list");
    // The query library reads every list again as the network comes back.
    await context.setOffline(true);
    await context.setOffline(false);

    expect(await refused).toMatchObject({ word: NOT_THE_OPERATOR });
    await expect(listOf(page).getByRole("table")).toHaveCount(0);
    await saysOfItsRead(listOf(page));
    await expect(searchOf(page)).toBeVisible();
    await expect(searchOf(page)).toBeFocused();
    await expect(searchOf(page)).toHaveValue("colne");
  });

  test("closes the console on entry once the mark is cleared", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Rossendale Forge");
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
    const pages = navOf(page, "Console").getByRole("link");
    await expect(pages).toHaveText(["Everyone", "Names Waiting", "Every Workspace"]);
    await pages.filter({ hasText: "Names Waiting" }).click();
    await expect(page).toHaveURL("/console/people/names-waiting");
    await expect(page.getByRole("region", { name: "Names Waiting" })).toBeVisible();
  });

  test("keeps the console's regions on an address it lacks", async ({ page, request }) => {
    await theOperator(page, request, "Northern Tooling");

    await page.goto("/console/not-a-page");

    await expect(page.getByRole("heading", { level: 1, name: "Page Not Found" })).toBeVisible();
    await expect(railOf(page)).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Every Workspace" })).toHaveAttribute(
      "href",
      HOMES.operator.path,
    );
  });

  test("scrolls nothing sideways at 320 pixels", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Acme Joinery");
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(EVERY_WORKSPACE);
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    await expect(rowOf(page, workspace.name)).toBeVisible();

    await expect(listOf(page).getByRole("columnheader")).toHaveText(["Workspace", "Short Name"]);
    const room = {
      page: await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      table: await page
        .locator("[data-slot=table-container]")
        .evaluate((table) => table.scrollWidth - table.clientWidth),
    };
    expect(room, "the page or its table scrolls sideways").toEqual({ page: 0, table: 0 });

    await listOf(page).getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Members" }).click();
    await page.keyboard.press("Escape");
    await expect(rowOf(page, workspace.name).getByRole("cell").nth(2)).toHaveText(/\b1\b/);
  });

  test("is keyboard-operable, sounds like a table and passes axe", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const workspace = await theOperator(page, request, "Pendle Toolworks");
    await page.goto(EVERY_WORKSPACE);
    const ours = rowOf(page, workspace.name);
    await expect(ours).toBeVisible();

    await skipLinkReachesThePage(page);

    await page.getByRole("link", { name: "Skip to the Page" }).focus();
    for (const stop of [
      page.getByRole("banner").getByRole("link", { name: "better-answers" }),
      switcherOf(page, "Console"),
      page.getByRole("button", { name: "Hide Menu" }),
      crumbOf(page, "Console"),
      crumbOf(page, "Workspaces"),
      page.getByRole("banner").getByRole("button", { name: "Jump To" }),
      avatarOf(page, workspace.admin.name),
      railOf(page).getByRole("link", { name: "Console" }),
      railOf(page).getByRole("button", { name: "Keyboard Shortcuts" }),
    ]) {
      await page.keyboard.press("Tab");
      await expect(stop).toBeFocused();
    }
    for (const name of ["Everyone", "Names Waiting", "Every Workspace"]) {
      await page.keyboard.press("Tab");
      await expect(navOf(page, "Console").getByRole("link", { name })).toBeFocused();
    }

    await expect(railOf(page)).toMatchAriaSnapshot(`
      - navigation "Areas":
        - list:
          - listitem:
            - link "Console"
        - button "Keyboard Shortcuts"
    `);

    await page.keyboard.press(WORKSPACES_KEYSTROKES.search.key);
    await expect(searchOf(page)).toBeFocused();
    await page.keyboard.type(workspace.name);
    await expect(workspaceRows(page)).toHaveCount(1);
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Workspaces" [level=1]
        - paragraph
        - region "Every Workspace":
          - heading "Every Workspace" [level=2]
          - paragraph
          - status: /\\b1\\b/
          - searchbox "Search by name or short name": ${JSON.stringify(workspace.name)}
          - table:
            - caption
            - rowgroup:
              - row "Workspace Short Name Members Provisioned":
                - columnheader "Workspace"
                - columnheader "Short Name"
                - columnheader "Members"
                - columnheader "Provisioned"
            - rowgroup:
              - row /${workspace.name}/:
                - cell /${workspace.name}/:
                  - button ${JSON.stringify(`More About ${workspace.name}`)}
                - cell ${JSON.stringify(workspace.shortName)}
                - cell /\\b1\\b/
                - cell /\\d{1,2} [A-Z][a-z]+ \\d{4}/
    `);

    await passesTheAccessibilityGate();

    const more = ours.getByRole("button", { name: `More About ${workspace.name}` });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(ours.getByText(workspace.workspaceId, { exact: true })).toBeVisible();
  });
});
