import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { ALL_WORKSPACES, goHome, JUMP_TO, RAIL, TOGGLE, UNKNOWN_PAGE } from "@/app/words.ts";
import {
  ACCOUNT_HEADING,
  AUTHENTICATOR_WORDS,
  RECOVERY_CODE_WORDS,
} from "@/features/auth/account-words.ts";
import { SETUP_WORDS } from "@/features/auth/second-factor-words.ts";
import { NO_WORKSPACE_HEADING, PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { WORKSPACES_WORDS } from "@/features/console/list-words.ts";
import { WORKSPACES_KEYSTROKES } from "@/features/console/people-keystrokes.ts";
import { NOT_THE_OPERATOR, ONLY_THE_OPERATOR } from "@/features/console/refusal-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { CONSOLE, HOMES, menuGroupIn } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";
import { CLEAR_WORDS, PRODUCT_NAME } from "@/shared/words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
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
  quoted,
  railOf,
  signedInAtHome,
  signIn,
  signInByEmail,
  skipLinkReachesThePage,
  switcherMenuOf,
  switcherOf,
  withAnAuthenticator,
} from "./harness.ts";
import { refusedFromNowOn } from "./refused-read.ts";

const LIST_BUDGET_MS = 1000;

const EVERY_WORKSPACE = HOMES.operator.path;

const WORKSPACES = menuGroupIn(CONSOLE, "workspaces");

const COLUMNS = WORKSPACES_WORDS.columns;

const CLOSED = "The console is better-answers support’s alone";

const UK_DAY =
  /^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;

/** The way in is the switcher's, offered from the operator's standing as last read. */
const theConsoleOffered = async (page: Page, workspaceName: string) => {
  await switcherOf(page, workspaceName).click();
  const theConsole = switcherMenuOf(page, workspaceName).getByRole("menuitem", {
    name: CONSOLE.name,
  });
  await expect(theConsole).toBeVisible();
  return theConsole;
};

/** An item of the switcher reads its workspace's name, then the person's role there. */
const listedAs = (name: string, role: "Admin" | "Viewer"): string => `${name} ${role}`;

const listOf = (page: Page) => page.getByRole("region", { name: WORKSPACES_WORDS.heading });

const searchOf = (page: Page) =>
  listOf(page).getByRole("searchbox", { name: WORKSPACES_WORDS.search });

/** The list's one count, which the head says and nothing else in the region repeats. */
const countOf = (page: Page) => listOf(page).getByRole("status");

/** The header row is a row too, so the workspaces are the rows with a cell. */
const workspaceRows = (page: Page): Locator =>
  listOf(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

/** A workspace's row, found by the disclosure it alone carries. */
const rowOf = (page: Page, name: string): Locator =>
  workspaceRows(page).filter({
    has: page.getByRole("button", { name: WORKSPACES_WORDS.moreAbout(name), exact: true }),
  });

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
    await expect(navOf(page, CONSOLE).getByRole("link")).toHaveText([
      "Everyone",
      "Names waiting",
      "Every workspace",
    ]);
    await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);

    const you = await personMenuOpened(page, workspace.admin.name);
    await expect(you.getByText(workspace.admin.name, { exact: true })).toBeVisible();
    await expect(you).not.toContainText("Admin");
    await expect(you.getByRole("menuitem")).toHaveText([ACCOUNT_HEADING, "Sign out"]);
  });

  test("offers no console to a person without the mark", async ({ page, request }) => {
    const workspace = await anAdmin(page, request, "Pennine Metalwork");

    await switcherOf(page, workspace.name).click();
    const menu = switcherMenuOf(page, workspace.name);
    await expect(menu.getByRole("menuitemradio")).toHaveText([listedAs(workspace.name, "Admin")]);
    await expect(menu.getByRole("menuitem")).toHaveText([ALL_WORKSPACES]);
    await page.keyboard.press("Escape");

    const you = await personMenuOpened(page, workspace.admin.name);
    await expect(you.getByRole("menuitem")).toHaveText([ACCOUNT_HEADING, "Sign out"]);
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

  test("sends a no-workspace operator to the console after setup", async ({ page, request }) => {
    const email = anAddress("operator");
    await person(request, email);
    await markTheOperator(request, email);
    await page.goto("/sign-in");
    await signInByEmail(page, request, email);

    await page.getByRole("button", { name: SETUP_WORDS.authenticatorInstead }).click();
    const key = await keyShown(page);
    await page.getByLabel(AUTHENTICATOR_WORDS.codeField).fill(authenticatorCodeAt(key, new Date()));
    await page.getByRole("checkbox", { name: RECOVERY_CODE_WORDS.saved }).check();
    await page.getByRole("button", { name: RECOVERY_CODE_WORDS.finish }).click();

    await expect(page).toHaveURL(EVERY_WORKSPACE);
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    await expect(switcherOf(page, CONSOLE.name)).toBeVisible();
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
    await expect(page.getByRole("heading", { name: NO_WORKSPACE_HEADING })).toHaveCount(0);
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
    // No workspace is open in the console, so the list reads in name order, each role its own.
    await expect(menu.getByRole("menuitemradio")).toHaveText([
      listedAs(second.name, "Viewer"),
      listedAs(workspace.name, "Admin"),
    ]);
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

test.describe("the console's Workspaces page", () => {
  test("lists workspaces in a table, each id one disclosure in", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Dales Engineering");
    const acme = await provision(request, { name: aNameOfItsOwn("Acme Holdings") });
    const colleague = await person(request, anAddress("colleague"));
    await addMember(request, {
      workspaceId: acme.workspaceId,
      userId: colleague.id,
      role: "Editor",
    });

    await page.goto(EVERY_WORKSPACE);

    await expect(listOf(page).getByRole("columnheader")).toHaveText(Object.values(COLUMNS));
    const theirs = rowOf(page, acme.name);
    await expect(theirs.getByRole("cell").nth(1)).toHaveText(acme.shortName);
    await expect(theirs.getByRole("cell").nth(2)).toHaveText("2 members");
    await expect(theirs.getByRole("cell").nth(3)).toHaveText(UK_DAY);
    await expect(rowOf(page, workspace.name).getByRole("cell").nth(2)).toHaveText("1 member");

    await expect(
      listOf(page).getByText(acme.workspaceId, { exact: true }),
      "a workspace's id shows before its disclosure opens",
    ).toHaveCount(0);
    await theirs.getByRole("button", { name: WORKSPACES_WORDS.moreAbout(acme.name) }).click();
    await expect(theirs.getByText(acme.workspaceId, { exact: true })).toBeVisible();
  });

  test("narrows by name or short name, saying when none match", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const workspace = await theOperator(page, request, "Ribble Castings");
    const other = await provision(request, { name: aNameOfItsOwn("Lune Bindery") });
    await page.goto(EVERY_WORKSPACE);
    await expect(rowOf(page, other.name)).toBeVisible();

    const listed = await keystrokesListed(page, HOMES.operator.name);
    await expect(listed.getByRole("definition")).toHaveText([
      WORKSPACES_KEYSTROKES.search.action,
      KEYSTROKE_WORDS.showTheList,
      JUMP_TO.name,
    ]);
    await keystrokesDismissed(page, listed);

    const shouted = workspace.name.toUpperCase();
    await page.keyboard.press(WORKSPACES_KEYSTROKES.search.key);
    await expect(searchOf(page)).toBeFocused();
    await page.keyboard.type(shouted);
    await expect(workspaceRows(page)).toHaveCount(1);
    await expect(rowOf(page, workspace.name)).toBeVisible();
    await expect(countOf(page)).toHaveText(WORKSPACES_WORDS.matching(1, shouted));

    await searchOf(page).fill(other.shortName);
    await expect(workspaceRows(page)).toHaveCount(1);
    await expect(rowOf(page, other.name)).toBeVisible();

    const nowhere = `nowhere ${workspace.shortName}`;
    await searchOf(page).fill(nowhere);
    await expect(listOf(page)).toContainText(WORKSPACES_WORDS.noneMatch(nowhere));
    await expect(countOf(page)).toHaveText(WORKSPACES_WORDS.matching(0, nowhere));
    await passesTheAccessibilityGate();
    await listOf(page).getByRole("button", { name: CLEAR_WORDS.search }).click();

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
      buttons.filter((name) => !name.startsWith(WORKSPACES_WORDS.moreAbout(""))),
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

  test("says who may read the list once the mark clears", async ({ page, request }) => {
    const workspace = await theOperator(page, request, "Calder Pressings");
    await page.goto(EVERY_WORKSPACE);
    await expect(rowOf(page, workspace.name)).toBeVisible();

    await markTheOperator(request, workspace.admin.email, "revoke");
    // A move between the console's own pages keeps its standing, so the list asks again alone.
    await navOf(page, CONSOLE).getByRole("link", { name: "Everyone" }).click();
    await navOf(page, CONSOLE).getByRole("link", { name: "Every workspace" }).click();

    await expect(listOf(page)).toContainText(sentenceOf(ONLY_THE_OPERATOR));
    await expect(listOf(page)).not.toContainText(NOT_THE_OPERATOR);
    await expect(listOf(page).getByRole("table")).toHaveCount(0);
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
    // The query library reads every list again as the network comes back.
    await context.setOffline(true);
    await context.setOffline(false);

    await expect(listOf(page)).toContainText(sentenceOf(ONLY_THE_OPERATOR));
    await expect(listOf(page).getByRole("table")).toHaveCount(0);
    await expect(searchOf(page)).toBeVisible();
    await expect(searchOf(page)).toBeFocused();
    await expect(searchOf(page)).toHaveValue("colne");
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
    const pages = navOf(page, CONSOLE).getByRole("link");
    await expect(pages).toHaveText(["Everyone", "Names waiting", "Every workspace"]);
    await pages.filter({ hasText: "Names waiting" }).click();
    await expect(page).toHaveURL("/console/people/names-waiting");
    await expect(page.getByRole("region", { name: "Names waiting" })).toBeVisible();
  });

  test("keeps the console's regions on an address it lacks", async ({ page, request }) => {
    await theOperator(page, request, "Northern Tooling");

    await page.goto("/console/not-a-page");

    await expect(page.getByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading })).toBeVisible();
    await expect(railOf(page)).toBeVisible();
    await expect(page.getByRole("link", { name: goHome(HOMES.operator) })).toHaveAttribute(
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

    // Four columns outrun a narrow window, so it opens on two and its menu shows the rest again.
    await expect(listOf(page).getByRole("columnheader")).toHaveText([
      COLUMNS.workspace,
      COLUMNS.shortName,
    ]);
    const room = await page.evaluate(() => {
      const table = document.querySelector("[data-slot=table-container]");
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        table: (table?.scrollWidth ?? 0) - (table?.clientWidth ?? 0),
      };
    });
    expect(room, "the page or its table scrolls sideways").toEqual({ page: 0, table: 0 });

    await listOf(page).getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: COLUMNS.memberCount }).click();
    await page.keyboard.press("Escape");
    await expect(rowOf(page, workspace.name).getByRole("cell").nth(2)).toHaveText("1 member");
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

    // Back to the first stop, to walk the regions in the order the document gives them.
    await page.getByRole("link", { name: "Skip to the page" }).focus();
    for (const stop of [
      page.getByRole("banner").getByRole("link", { name: PRODUCT_NAME }),
      switcherOf(page, CONSOLE.name),
      page.getByRole("button", { name: TOGGLE.hide }),
      crumbOf(page, CONSOLE.name),
      crumbOf(page, "Workspaces"),
      page.getByRole("banner").getByRole("button", { name: JUMP_TO.name }),
      avatarOf(page, workspace.admin.name),
      railOf(page).getByRole("link", { name: CONSOLE.name }),
      railOf(page).getByRole("button", { name: KEYSTROKE_WORDS.button }),
    ]) {
      await page.keyboard.press("Tab");
      await expect(stop).toBeFocused();
    }
    for (const name of ["Everyone", "Names waiting", "Every workspace"]) {
      await page.keyboard.press("Tab");
      await expect(navOf(page, CONSOLE).getByRole("link", { name })).toBeFocused();
    }

    await expect(railOf(page)).toMatchAriaSnapshot(`
      - navigation "${RAIL}":
        - list:
          - listitem:
            - link "${CONSOLE.name}"
        - button "${KEYSTROKE_WORDS.button}"
    `);

    // The count is the whole platform's, so the page is read narrowed to this test's own row.
    await page.keyboard.press(WORKSPACES_KEYSTROKES.search.key);
    await expect(searchOf(page)).toBeFocused();
    await page.keyboard.type(workspace.name);
    await expect(workspaceRows(page)).toHaveCount(1);
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${quoted(WORKSPACES.name)} [level=1]
        - paragraph: ${quoted(WORKSPACES.summary)}
        - region ${quoted(WORKSPACES_WORDS.heading)}:
          - heading ${quoted(WORKSPACES_WORDS.heading)} [level=2]
          - paragraph: ${quoted(WORKSPACES_WORDS.description)}
          - status: ${quoted(WORKSPACES_WORDS.matching(1, workspace.name))}
          - searchbox ${quoted(WORKSPACES_WORDS.search)}: ${quoted(workspace.name)}
          - table:
            - caption: ${quoted(WORKSPACES_WORDS.caption)}
            - rowgroup:
              - row ${quoted(Object.values(COLUMNS).join(" "))}:
                - columnheader ${quoted(COLUMNS.workspace)}
                - columnheader ${quoted(COLUMNS.shortName)}
                - columnheader ${quoted(COLUMNS.memberCount)}
                - columnheader ${quoted(COLUMNS.createdAt)}
            - rowgroup:
              - row /${workspace.name}/:
                - cell /${workspace.name}/:
                  - button ${quoted(WORKSPACES_WORDS.moreAbout(workspace.name))}
                - cell ${quoted(workspace.shortName)}
                - cell "1 member"
                - cell /\\d{1,2} [A-Z][a-z]+ \\d{4}/
    `);

    await passesTheAccessibilityGate();

    const more = ours.getByRole("button", { name: WORKSPACES_WORDS.moreAbout(workspace.name) });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(ours.getByText(workspace.workspaceId, { exact: true })).toBeVisible();
  });
});
