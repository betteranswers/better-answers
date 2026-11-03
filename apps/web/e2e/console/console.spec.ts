import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { WORKSPACES_KEYSTROKES } from "@/features/console/people-keystrokes.ts";
import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  avatarOf,
  crumbOf,
  keyShown,
  markTheOperator,
  navOf,
  person,
  personMenuOpened,
  provision,
  railOf,
  signedInAtHome,
  signIn,
  signInByEmail,
  skipLinkReachesThePage,
  switcherMenuOf,
  switcherOf,
  withAnAuthenticator,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const EVERY_WORKSPACE = HOMES.operator.path;

const controlCentreMenu = (page: Page) => navOf(page, "Control Centre");

const noWorkspaceYet = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No Workspace Yet" });

const theConsoleOffered = async (page: Page, workspaceName: string) => {
  await switcherOf(page, workspaceName).click();
  const theConsole = switcherMenuOf(page, workspaceName).getByRole("menuitem", {
    name: "Console",
  });
  await expect(theConsole).toBeVisible();
  return theConsole;
};

const listOf = (page: Page) => page.getByRole("region", { name: "Every Workspace" });

const searchOf = (page: Page) =>
  listOf(page).getByRole("searchbox", { name: "Search by name or short name" });

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
});

test.describe("the console's Workspaces page", () => {
  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Wensleydale Precision");

    const started = Date.now();
    await page.goto(EVERY_WORKSPACE);
    await expect(rowOf(page, workspace.name)).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "workspaces list", description: `${elapsed} ms` });
    expect(elapsed, "the workspaces list took longer than its second").toBeLessThan(LIST_BUDGET_MS);
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
