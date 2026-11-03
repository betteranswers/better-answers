import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  NAMES_WAITING_KEYSTROKES,
  PEOPLE_KEYSTROKES,
} from "@/features/console/people-keystrokes.ts";
import { CONSOLE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  aPkcePair,
  catchClaudesRedirect,
  CLAUDES_REDIRECT_URI,
  claudeExchanges,
  claudesAuthorizeUrl,
  clockTheNextKey,
  countOf,
  flagTheName,
  keystrokesDismissed,
  keystrokesButton,
  keystrokesListed,
  markTheOperator,
  person,
  provision,
  signedInAtHome,
  signIn,
  skipLinkReachesThePage,
  theActionLandedWithinItsBudget,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const PEOPLE = menuGroupIn(CONSOLE, "people");

const EVERYONE_PAGE = pageNamed(PEOPLE, "Everyone").path;

const NAMES_WAITING_PAGE = pageNamed(PEOPLE, "Names Waiting").path;

const INSTANT_WORDS = String.raw`\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}`;

const INSTANT = new RegExp(`^${INSTANT_WORDS}$`);

const REVOKE = "End Every Sign-In and Token";

const ENDED_AT = /\d{2}:\d{2}/;

const aTag = (): string => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const thePage = (page: Page) => page.getByRole("main", { name: "Page" });

const everyone = (page: Page) => page.getByRole("region", { name: "Everyone" });

const outcomeOf = (list: Locator): Locator => list.locator("output:has(+ [role='alert'])");

const searchBox = (page: Page) =>
  everyone(page).getByRole("searchbox", { name: "Search by name or address" });

const personRows = (page: Page): Locator =>
  everyone(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const personButton = (page: Page, name: string): Locator =>
  everyone(page).getByRole("button", { name, exact: true });

const sheetOf = (page: Page, name: string): Locator => page.getByRole("dialog", { name });

const regionOf = (sheet: Locator, name: string): Locator =>
  sheet.getByRole("region", { name, exact: true });

const sessionsOf = (sheet: Locator): Locator => regionOf(sheet, "Sessions").getByRole("listitem");

const confirmationOf = (page: Page): Locator =>
  page.getByRole("dialog", { name: `${REVOKE} for Priya Shah` });

const theOperatorsWorkspace = async (api: APIRequestContext, tag: string) => {
  const email = anAddress(`${tag}-operator`);
  const workspace = await provision(api, { name: `Operators ${tag}`, adminEmail: email });
  await markTheOperator(api, email);
  return workspace;
};

const signedInAsTheOperator = async (page: Page, api: APIRequestContext, tag: string) => {
  const workspace = await theOperatorsWorkspace(api, tag);
  await signedInAtHome(page, api, workspace.admin.email);
  return workspace;
};

const originOf = (baseURL: string | undefined): string => {
  if (baseURL === undefined) throw new Error("playwright.config.ts gives the suite no baseURL");
  return baseURL;
};

const claudeConnectedAs = async (
  page: Page,
  api: APIRequestContext,
  origin: string,
  email: string,
) => {
  const { verifier, challenge } = aPkcePair();
  await catchClaudesRedirect(page);
  await page.goto(claudesAuthorizeUrl(origin, { challenge, prompt: "consent" }));
  await signIn(page, api, email);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page).toHaveURL(new RegExp(`^${CLAUDES_REDIRECT_URI}`));
  const code = new URL(page.url()).searchParams.get("code") ?? "";

  const exchanged = await claudeExchanges(api, { origin, code, verifier });
  await page.unroute(`${CLAUDES_REDIRECT_URI}*`);
  await page.context().clearCookies();
  return exchanged;
};

const priyaConnected = async (
  page: Page,
  api: APIRequestContext,
  baseURL: string | undefined,
  tag: string,
) => {
  const operators = await theOperatorsWorkspace(api, tag);
  const priya = await person(api, anAddress(`${tag}-priya`), { displayName: "Priya Shah" });
  await addMember(api, { workspaceId: operators.workspaceId, userId: priya.id, role: "Editor" });
  const { refreshToken } = await claudeConnectedAs(page, api, originOf(baseURL), priya.email);
  await signedInAtHome(page, api, operators.admin.email);
  return { operators, priya, refreshToken };
};

const openPriya = async (page: Page, tag: string): Promise<Locator> => {
  await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
  await personButton(page, "Priya Shah").click();
  const sheet = sheetOf(page, "Priya Shah");
  await expect(sessionsOf(sheet)).toHaveCount(1);
  return sheet;
};

const correctionOf = (name: string): string => `Correct ${name}’s Display Name`;

const dialogToCorrect = (page: Page, name: string): Locator =>
  page.getByRole("dialog", { name: correctionOf(name) });

const nameFieldOf = (dialog: Locator): Locator =>
  dialog.getByRole("textbox", { name: "Display Name" });

const namesWaiting = (page: Page) => page.getByRole("region", { name: "Names Waiting" });

const waitingCount = (page: Page): Locator => countOf(namesWaiting(page));

const waitingSearch = (page: Page): Locator =>
  namesWaiting(page).getByRole("searchbox", { name: "Search by name or workspace" });

const waitingRows = (page: Page): Locator =>
  namesWaiting(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const waitingRowOf = (page: Page, name: string): Locator =>
  namesWaiting(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });

const correctButtonOf = (page: Page, name: string): Locator =>
  waitingRowOf(page, name).getByRole("button", { name: correctionOf(name) });

const priyaWithTheOperator = async (
  page: Page,
  api: APIRequestContext,
  asked: { readonly tag: string; readonly displayName: string },
) => {
  const operators = await signedInAsTheOperator(page, api, asked.tag);
  const priya = await person(api, anAddress(`${asked.tag}-priya`), {
    displayName: asked.displayName,
  });
  await addMember(api, { workspaceId: operators.workspaceId, userId: priya.id, role: "Editor" });
  return { operators, priya };
};

const priyaFlagged = async (page: Page, api: APIRequestContext, tag: string) => {
  const name = `Priya Shah ${tag}`;
  const { operators, priya } = await priyaWithTheOperator(page, api, { tag, displayName: name });
  await flagTheName(api, {
    workspaceId: operators.workspaceId,
    adminId: operators.admin.id,
    personId: priya.id,
  });
  return { operators, priya, name };
};

const priyaListed = async (page: Page, api: APIRequestContext, tag: string) => {
  const held = await priyaWithTheOperator(page, api, { tag, displayName: "Priya Shah" });
  await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
  return held;
};

test.describe("the console's Everyone page", () => {
  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await signedInAsTheOperator(page, request, aTag());

    const started = Date.now();
    await page.goto(EVERYONE_PAGE);
    await expect(personRows(page).first()).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "everyone list", description: `${elapsed} ms` });
    expect(elapsed, "the first page of everyone rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  test("opens no person by key after focus leaves the list", async ({ page, request }) => {
    await priyaListed(page, request, aTag());
    await expect(personRows(page)).toHaveCount(2);
    const said = outcomeOf(everyone(page));
    await expect(said, "the list says nothing at rest").toHaveText("");
    await personButton(page, "Priya Shah").focus();
    await keystrokesButton(page).focus();

    for (const key of ["o", "r", "c"]) {
      await page.keyboard.press(key);
      await expect(said, `${key} with no person in focus said nothing`).toHaveText(/\S/);
      await expect(page.getByRole("dialog"), `${key} opened a person not in focus`).toHaveCount(0);
    }
  });

  test("is keyboard-operable, sounds like a table and passes axe", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    const operators = await signedInAsTheOperator(page, request, tag);
    await person(request, anAddress(`${tag}-priya`), { displayName: "Priya Shah" });
    await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
    await expect(personRows(page)).toHaveCount(2);

    await expect(thePage(page)).toMatchAriaSnapshot(`
      - main "Page":
        - heading "People" [level=1]
        - paragraph
        - region "Everyone":
          - heading "Everyone" [level=2]
          - paragraph
          - status: /\\b2\\b/
          - searchbox "Search by name or address": ${tag}
          - table:
            - caption
            - rowgroup:
              - row "Person Workspaces and Roles Last Sign-In":
                - columnheader "Person"
                - columnheader "Workspaces and Roles"
                - columnheader "Last Sign-In"
            - rowgroup:
              - row /Priya Shah/:
                - cell /Priya Shah/:
                  - button "Priya Shah"
                - cell
                - cell
              - row /Test person/:
                - cell /Test person/:
                  - button "Test person"
                - cell "${operators.name} Admin":
                  - list:
                    - listitem: ${operators.name} Admin
                - cell /\\d{2}:\\d{2} · \\d{1,2} [A-Z][a-z]+ \\d{4}/
    `);
    await expect(
      everyone(page).getByText("Search by name or address", { exact: true }),
      "the search is a labelled field of its own again",
    ).toHaveCount(0);
    await passesTheAccessibilityGate();

    await skipLinkReachesThePage(page);
    await page.keyboard.press("o");
    await expect(outcomeOf(everyone(page))).toHaveText(/\S/);
    await expect(page.getByRole("dialog"), "a person opened with none in focus").toHaveCount(0);

    const listed = (await keystrokesListed(page, "Everyone")).getByRole("definition");
    await expect(listed).toHaveText([
      "Search Everyone by Name or Address",
      "Open the Person in Focus",
      "End Every Sign-In and Token of the Person in Focus",
      "Correct the Display Name of the Person in Focus",
      "Show the Previous Page of People",
      "Show the Next Page of People",
      "Show This List",
      "Jump To",
    ]);
    await page.keyboard.press("Escape");
    await expect(listed).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Keyboard Shortcuts" })).toBeFocused();

    await page.keyboard.press(PEOPLE_KEYSTROKES.search.key);
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page), "Escape cleared the search and lost its place").toBeFocused();
    await page.keyboard.type(`${tag}-priya`);
    await expect(personRows(page)).toHaveCount(1);

    const priya = personButton(page, "Priya Shah");
    await priya.focus();
    await page.keyboard.press("o");
    await expect(sheetOf(page, "Priya Shah").getByRole("heading", { level: 2 })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(priya).toBeFocused();

    await page.keyboard.press("c");
    await expect(
      sheetOf(page, "Priya Shah").getByRole("button", { name: "Correct Display Name" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(priya).toBeFocused();
  });
});

test.describe("a person, opened from Everyone as a sheet", () => {
  test("ends every sign-in everywhere behind a confirmation, within its budget", async ({
    page,
    request,
    baseURL,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    const { operators } = await priyaConnected(page, request, baseURL, tag);
    const sheet = await openPriya(page, tag);
    const revoke = sheet.getByRole("button", { name: REVOKE });
    const grant = regionOf(sheet, "Assistant Access").getByRole("listitem", { name: "Claude" });
    await expect(grant).toBeVisible();

    await revoke.click();
    const confirmation = confirmationOf(page);
    await expect(confirmation).toHaveAccessibleDescription(/Priya Shah/);
    await passesTheAccessibilityGate();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(revoke).toBeFocused();
    await expect(sessionsOf(sheet)).toHaveCount(1);

    await revoke.click();
    await confirmation.getByRole("button", { name: "End Every Sign-In Everywhere" }).focus();
    await clockTheNextKey(page, {
      at: "//section[div[@data-slot='card-header']/h3[normalize-space(.)='Sessions']][not(.//li)]",
      reads: "Sessions",
    });
    await page.keyboard.press("Enter");

    await expect(sessionsOf(sheet)).toHaveCount(0);
    await theActionLandedWithinItsBudget(page, "end every sign-in everywhere");
    await expect(regionOf(sheet, "End Every Sign-In Everywhere").getByRole("status")).toHaveText(
      ENDED_AT,
    );
    await expect(revoke).toBeFocused();
    const endedEverywhere = `
      - listitem "Claude":
        - heading "Claude" [level=4]
        - term: Workspace
        - definition: ${operators.name}
        - term: Issued
        - definition: /\\d{4}/
        - term: Ended
        - definition: /\\d{4}/
        - term: Ended By
        - definition: ${operators.admin.name}
        - term: Ended In
        - definition: /^(?!${operators.name}$).+/
        - button "More About Claude’s Grant"
    `;
    await expect(grant).toMatchAriaSnapshot(endedEverywhere);
    await expect(regionOf(sheet, "Sign-In").getByRole("definition").nth(1)).toHaveText(INSTANT);

    await page.reload();
    await personButton(page, "Priya Shah").click();
    await expect(sessionsOf(sheet)).toHaveCount(0);
    await expect(grant).toMatchAriaSnapshot(endedEverywhere);
  });
});

test.describe("the console's Names Waiting page", () => {
  test("lists each flagged name with its flags, within budget", async ({ page, request }) => {
    const tag = aTag();
    const { operators, priya, name } = await priyaFlagged(page, request, tag);
    const beta = await provision(request, { name: `Beta ${tag}` });
    await addMember(request, { workspaceId: beta.workspaceId, userId: priya.id, role: "Viewer" });
    await flagTheName(request, {
      workspaceId: beta.workspaceId,
      adminId: beta.admin.id,
      personId: priya.id,
    });

    const started = Date.now();
    await page.goto(NAMES_WAITING_PAGE);
    await expect(waitingRowOf(page, name)).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "names waiting list", description: `${elapsed} ms` });
    expect(elapsed, "the names waiting rendered past their budget").toBeLessThan(LIST_BUDGET_MS);

    await waitingSearch(page).fill(name);
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(thePage(page)).toMatchAriaSnapshot(`
      - main "Page":
        - heading "People" [level=1]
        - paragraph
        - region "Names Waiting":
          - heading "Names Waiting" [level=2]
          - paragraph
          - status: /\\b1\\b/
          - searchbox "Search by name or workspace": ${JSON.stringify(name)}
          - table:
            - caption
            - rowgroup:
              - row "Person Flagged By Actions":
                - columnheader "Person"
                - columnheader "Flagged By"
                - columnheader "Actions"
            - rowgroup:
              - row /${name}/:
                - cell "${name}"
                - cell:
                  - list:
                    - listitem: /^${operators.name} ${INSTANT_WORDS}$/
                    - listitem: /^Beta ${tag} ${INSTANT_WORDS}$/
                - cell:
                  - button ${JSON.stringify(correctionOf(name))}
    `);
  });

  test("narrows by name or workspace, and says when none match", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    const { operators, name } = await priyaFlagged(page, request, tag);
    await page.goto(NAMES_WAITING_PAGE);
    await expect(waitingRowOf(page, name)).toBeVisible();

    const shouted = name.toUpperCase();
    await page.keyboard.press(NAMES_WAITING_KEYSTROKES.search.key);
    await expect(waitingSearch(page)).toBeFocused();
    await page.keyboard.type(shouted);
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(waitingRowOf(page, name)).toBeVisible();
    await expect(waitingCount(page)).toHaveText(/\b1\b/);

    await waitingSearch(page).fill(operators.name);
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(waitingRowOf(page, name)).toBeVisible();

    const nobody = `nobody ${tag}`;
    await waitingSearch(page).fill(nobody);
    await expect(waitingCount(page)).toHaveText(/\b0\b/);
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(waitingRows(page).getByRole("button")).toHaveText(["Clear Search"]);
    const narrowed = await waitingCount(page).innerText();
    await passesTheAccessibilityGate();

    await page.keyboard.press("Escape");
    await expect(waitingSearch(page)).toHaveValue("");
    await expect(waitingSearch(page), "Escape cleared the search and lost its place").toBeFocused();
    await expect(waitingRowOf(page, name)).toBeVisible();
    await expect(waitingCount(page), "the count still says what the search left").not.toHaveText(
      narrowed,
    );
    await expect(waitingCount(page)).toHaveText(/\d/);
  });

  test("corrects no name by key after focus leaves the list", async ({ page, request }) => {
    const { name } = await priyaFlagged(page, request, aTag());
    await page.goto(NAMES_WAITING_PAGE);
    const said = outcomeOf(namesWaiting(page));
    await expect(correctButtonOf(page, name)).toBeVisible();
    await expect(said, "the list says nothing at rest").toHaveText("");
    await correctButtonOf(page, name).focus();
    await keystrokesButton(page).focus();

    await page.keyboard.press("c");
    await expect(said, "c with no name in focus said nothing").toHaveText(/\S/);
    await expect(page.getByRole("dialog"), "c corrected a name not in focus").toHaveCount(0);
  });

  test("is keyboard-operable and lists its keystrokes", async ({ page, request }) => {
    const { name } = await priyaFlagged(page, request, aTag());
    await page.goto(NAMES_WAITING_PAGE);
    await expect(waitingRowOf(page, name)).toBeVisible();

    await skipLinkReachesThePage(page);
    await page.keyboard.press("c");
    await expect(outcomeOf(namesWaiting(page))).toHaveText(/\S/);
    await expect(page.getByRole("dialog"), "a name opened with none in focus").toHaveCount(0);
    const listed = await keystrokesListed(page, "Names Waiting");
    await expect(listed.getByRole("definition")).toHaveText([
      "Search the Names Waiting by Name or Workspace",
      "Correct the Display Name in Focus",
      "Show This List",
      "Jump To",
    ]);
    await keystrokesDismissed(page, listed);

    const correct = correctButtonOf(page, name);
    await correct.focus();
    await page.keyboard.press("c");
    const dialog = dialogToCorrect(page, name);
    await expect(nameFieldOf(dialog)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(correct).toBeFocused();
  });
});
