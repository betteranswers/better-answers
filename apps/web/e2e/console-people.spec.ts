import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { JUMP_TO } from "@/app/words.ts";
import { correctWords } from "@/features/console/correcting-words.ts";
import { EVERYONE_WORDS, NAMES_WAITING_WORDS } from "@/features/console/list-words.ts";
import {
  NAMES_WAITING_KEYSTROKES,
  PEOPLE_KEYSTROKES,
} from "@/features/console/people-keystrokes.ts";
import { NOT_THE_OPERATOR, SIGN_IN_TOO_OLD } from "@/features/console/refusal-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { CONSOLE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { CLEAR_WORDS } from "@/shared/words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  ageTheSignIn,
  anAddress,
  aPkcePair,
  catchClaudesRedirect,
  CLAUDES_REDIRECT_URI,
  claudeDisconnects,
  claudeExchanges,
  claudesAuthorizeUrl,
  clockTheNextKey,
  flagTheName,
  keystrokesDismissed,
  keystrokesListed,
  markTheOperator,
  navOf,
  person,
  provision,
  quoted,
  saysARefusal,
  saysOfItsRead,
  signedInAtHome,
  signIn,
  skipLinkReachesThePage,
  theActionLandedWithinItsBudget,
} from "./harness.ts";
import { refusalAnswering, refusedFromNowOn } from "./refused-read.ts";

const LIST_BUDGET_MS = 1000;

const PEOPLE = menuGroupIn(CONSOLE, "people");

/** Where the console's People group opens. */
const EVERYONE = pageNamed(PEOPLE, "Everyone");

const EVERYONE_PAGE = EVERYONE.path;

const NAMES_WAITING = pageNamed(PEOPLE, "Names Waiting");

const NAMES_WAITING_PAGE = NAMES_WAITING.path;

/** Written once, so an aria snapshot can set it after a workspace's name. */
const INSTANT_WORDS = String.raw`\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}`;

const INSTANT = new RegExp(`^${INSTANT_WORDS}$`);

const REVOKE = "End Every Sign-In and Token";

const CORRECT_A_NAME = "console.people.correctDisplayName";

/** The instant an ending is said with: a line still on its way holds none. */
const ENDED_AT = /\d{2}:\d{2}/;

/** Fifty-one people over pages of fifty, as each page counts its own. */
const THE_FIRST_PAGE = /\b1\D+50\D+51\b/;

const THE_LAST_PAGE = /\b51\D+51\D+51\b/;

/** What the page said, as a pattern's own text, so its full stop matches a full stop alone. */
const asWritten = (said: string): string => said.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

/** Everyone the run makes is on this list, so a test finds its own by a tag in their address. */
const aTag = (): string => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;

/** A page's own regions, under the head its group gives it. */
const thePage = (page: Page) => page.getByRole("main", { name: "Page" });

/** What `?` lists on a page: its own keystrokes, then the two every page has. */
const listedFor = (own: Readonly<Record<string, { readonly action: string }>>): string[] => [
  ...Object.values(own).map((keystroke) => keystroke.action),
  KEYSTROKE_WORDS.showTheList,
  JUMP_TO.name,
];

const everyone = (page: Page) => page.getByRole("region", { name: EVERYONE_WORDS.heading });

/** A list's count is its head's, so it is the first status its region holds. */
const countOf = (list: Locator): Locator => list.getByRole("status").first();

/** An outcome's status stands beside its alert. A list's count and its pages' count have none. */
const outcomeOf = (list: Locator): Locator => list.locator("output:has(+ [role='alert'])");

const searchBox = (page: Page) =>
  everyone(page).getByRole("searchbox", { name: EVERYONE_WORDS.search });

/** The header row is a row too, so the people are the rows with a cell. */
const personRows = (page: Page): Locator =>
  everyone(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, text: string): Locator => personRows(page).filter({ hasText: text });

const personButton = (page: Page, name: string): Locator =>
  everyone(page).getByRole("button", { name, exact: true });

const sheetOf = (page: Page, name: string): Locator => page.getByRole("dialog", { name });

const regionOf = (sheet: Locator, name: string): Locator =>
  sheet.getByRole("region", { name, exact: true });

/** One item for each session the person holds open. */
const sessionsOf = (sheet: Locator): Locator => regionOf(sheet, "Sessions").getByRole("listitem");

const confirmationOf = (page: Page): Locator =>
  page.getByRole("dialog", { name: `${REVOKE} for Priya Shah` });

/** A workspace whose Admin carries the mark. */
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

/** The resource Claude asks for is the MCP surface on the suite's own origin. */
const originOf = (baseURL: string | undefined): string => {
  if (baseURL === undefined) throw new Error("playwright.config.ts gives the suite no baseURL");
  return baseURL;
};

/** Consented in the page, so the person holds a session and a grant; the page is signed out after. */
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

/**
 * Priya is an Editor in the operator's workspace, where Claude is connected as her; then the
 * operator signs in.
 */
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

const dialogToCorrect = (page: Page, name: string): Locator =>
  page.getByRole("dialog", { name: correctWords(name) });

const nameFieldOf = (dialog: Locator): Locator =>
  dialog.getByRole("textbox", { name: "Display Name" });

/** A name saved from a sheet: its part says so, and focus is back on its action. */
const savedInTheSheet = async (sheet: Locator): Promise<void> => {
  const part = regionOf(sheet, "Display Name");
  await expect(part.getByRole("status")).toHaveText(/\S/);
  await expect(part.getByRole("button", { name: "Correct Display Name" })).toBeFocused();
};

/**
 * Opens on the name as it stands, described by its rule and its consequence; Cancel hands focus
 * back. `audit` runs on the open dialog.
 */
const correctingCancelled = async (
  page: Page,
  correct: Locator,
  name: string,
  asked: { readonly audit: () => Promise<void> },
): Promise<Locator> => {
  await correct.click();
  const dialog = dialogToCorrect(page, name);
  await expect(nameFieldOf(dialog)).toBeFocused();
  await expect(nameFieldOf(dialog)).toHaveValue(name);
  await expect(nameFieldOf(dialog)).toHaveAccessibleDescription(/\b100\b/);
  await expect(dialog).toHaveAccessibleDescription(new RegExp(asWritten(name)));
  await asked.audit();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(correct).toBeFocused();
  return dialog;
};

const namesWaiting = (page: Page) =>
  page.getByRole("region", { name: NAMES_WAITING_WORDS.heading });

const waitingCount = (page: Page): Locator => countOf(namesWaiting(page));

const waitingSearch = (page: Page): Locator =>
  namesWaiting(page).getByRole("searchbox", { name: NAMES_WAITING_WORDS.search });

/** The header row is a row too, so the names are the rows with a cell. */
const waitingRows = (page: Page): Locator =>
  namesWaiting(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

/** Every name the run flags waits on this list, so a test's own name carries its tag. */
const waitingRowOf = (page: Page, name: string): Locator =>
  namesWaiting(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });

const correctButtonOf = (page: Page, name: string): Locator =>
  waitingRowOf(page, name).getByRole("button", { name: correctWords(name) });

/** Priya, named `displayName`, is an Editor in the operator's workspace. */
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

/** The operator, as Admin of her workspace, flags her name. */
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

/** From the key that saves to the list holding the name no more. */
const clockTheRowLeaving = (page: Page, name: string) =>
  clockTheNextKey(page, {
    at: `//section[h2[normalize-space(.)='Names Waiting']][not(.//td[normalize-space(.)='${name}'])]`,
    reads: "Names Waiting",
  });

/** The operator lands on Everyone, searched for her. */
const priyaListed = async (page: Page, api: APIRequestContext, tag: string) => {
  const held = await priyaWithTheOperator(page, api, { tag, displayName: "Priya Shah" });
  await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
  return held;
};

test.describe("the console's Everyone page", () => {
  test("lists each person with their workspaces, roles and last sign-in", async ({
    page,
    request,
  }) => {
    const tag = aTag();
    const operators = await signedInAsTheOperator(page, request, tag);
    const priya = await person(request, anAddress(`${tag}-priya`), { displayName: "Priya Shah" });
    await addMember(request, {
      workspaceId: operators.workspaceId,
      userId: priya.id,
      role: "Editor",
    });
    const beta = await provision(request, { name: `Beta ${tag}` });
    await addMember(request, { workspaceId: beta.workspaceId, userId: priya.id, role: "Viewer" });
    await person(request, anAddress(`${tag}-sam`), { displayName: "Sam Okoro" });

    await page.goto(`${EVERYONE_PAGE}?search=${tag}`);

    await expect(personRows(page)).toHaveCount(3);
    await expect(countOf(everyone(page))).toHaveText(/\b3\b/);
    const theirs = rowOf(page, "Priya Shah");
    await expect(theirs).toContainText(priya.email);
    await expect(theirs.getByRole("cell").nth(1).getByRole("listitem")).toHaveText([
      `${beta.name} Viewer`,
      `${operators.name} Editor`,
    ]);
    await expect(
      theirs.getByRole("cell").nth(2),
      "a person who never signed in shows an instant, or nothing",
    ).toHaveText(/^\D+$/);
    const sams = rowOf(page, "Sam Okoro").getByRole("cell").nth(1);
    await expect(sams.getByRole("listitem")).toHaveCount(0);
    await expect(sams, "a person in no workspace has an empty cell").toHaveText(/\S/);
    await expect(rowOf(page, operators.admin.email).getByRole("cell").nth(2)).toHaveText(INSTANT);
  });

  test("narrows by name or address, and says when none match", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    await signedInAsTheOperator(page, request, tag);
    await person(request, anAddress(`${tag}-priya`), { displayName: "Priya Shah" });
    await person(request, anAddress("ada"), { displayName: `Ada Hartley ${tag}` });
    await page.goto(EVERYONE_PAGE);

    await searchBox(page).fill(tag.toUpperCase());
    await expect(personRows(page)).toHaveCount(3);
    await expect(countOf(everyone(page))).toHaveText(/\b3\b/);

    await searchBox(page).fill(`hartley ${tag}`);
    await expect(personRows(page)).toHaveCount(1);
    await expect(rowOf(page, `Ada Hartley ${tag}`)).toBeVisible();
    await expect(countOf(everyone(page))).toHaveText(/\b1\b/);

    await searchBox(page).fill(`nobody ${tag}`);
    await expect(countOf(everyone(page))).toHaveText(/\b0\b/);
    // The one row left is the list's own, saying none match and offering to clear.
    await expect(personRows(page)).toHaveCount(1);
    await expect(personRows(page).getByRole("button")).toHaveText([CLEAR_WORDS.search]);
    const narrowed = await countOf(everyone(page)).innerText();
    await passesTheAccessibilityGate();
    await everyone(page).getByRole("button", { name: CLEAR_WORDS.search }).click();

    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page)).toBeFocused();
    await expect(
      countOf(everyone(page)),
      "the count still says what the search left",
    ).not.toHaveText(narrowed);
    await expect(countOf(everyone(page))).toHaveText(/\d/);
  });

  test("pages through more people than one page holds", async ({ page, request }) => {
    await signedInAsTheOperator(page, request, aTag());
    const tag = aTag();
    for (let made = 0; made < 51; made += 1) {
      await person(request, anAddress(`${tag}-${made}`), { displayName: `Person ${made}` });
    }

    await page.goto(`${EVERYONE_PAGE}?search=${tag}`);

    const paging = everyone(page).getByRole("navigation", { name: "Pages of People" });
    await expect(personRows(page)).toHaveCount(50);
    await expect(paging).toHaveText(THE_FIRST_PAGE);
    await expect(paging.getByRole("button", { name: "Previous Page" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const next = paging.getByRole("button", { name: "Next Page" });
    await next.click();
    await expect(personRows(page)).toHaveCount(1);
    await expect(paging).toHaveText(THE_LAST_PAGE);
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();

    await paging.getByRole("button", { name: "Previous Page" }).click();
    await expect(personRows(page)).toHaveCount(50);

    // A turn past either end moves nowhere, and the list's outcome says so.
    const said = outcomeOf(everyone(page));
    await expect(said).toBeEmpty();
    await page.keyboard.press(PEOPLE_KEYSTROKES.previous.key);
    await expect(said).toHaveText(/\S/);
    await expect(paging).toHaveText(THE_FIRST_PAGE);
    const atTheFirst = await said.innerText();
    await page.keyboard.press(PEOPLE_KEYSTROKES.next.key);
    await expect(paging).toHaveText(THE_LAST_PAGE);
    await page.keyboard.press(PEOPLE_KEYSTROKES.next.key);
    await expect(said, "the outcome still says the first page's end").not.toHaveText(atTheFirst);
    await expect(said).toHaveText(/\S/);
    await expect(paging).toHaveText(THE_LAST_PAGE);
    await page.keyboard.press(PEOPLE_KEYSTROKES.previous.key);
    await expect(paging).toHaveText(THE_FIRST_PAGE);
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await signedInAsTheOperator(page, request, aTag());

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto(EVERYONE_PAGE);
    await expect(personRows(page).first()).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "everyone list", description: `${elapsed} ms` });
    expect(elapsed, "the first page of everyone rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  test("takes the list away once the mark clears", async ({ page, request }) => {
    const tag = aTag();
    const operators = await signedInAsTheOperator(page, request, tag);
    await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
    await expect(personRows(page)).toHaveCount(1);

    await markTheOperator(request, operators.admin.email, "revoke");
    // A move between the console's own pages keeps its standing, so the list asks again alone.
    await navOf(page, CONSOLE).getByRole("link", { name: "Every Workspace" }).click();
    const refused = refusalAnswering(page, "console.people.list");
    await navOf(page, CONSOLE).getByRole("link", { name: "Everyone" }).click();

    expect(await refused).toMatchObject({ word: NOT_THE_OPERATOR, class: "forbidden" });
    await expect(everyone(page)).not.toContainText(NOT_THE_OPERATOR);
    await expect(everyone(page).getByRole("table")).toHaveCount(0);
    await saysOfItsRead(everyone(page));
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

    // The search sits in the list's own row, between its count and its table.
    await expect(thePage(page)).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${quoted(PEOPLE.name)} [level=1]
        - paragraph
        - region ${quoted(EVERYONE_WORDS.heading)}:
          - heading ${quoted(EVERYONE_WORDS.heading)} [level=2]
          - paragraph
          - status: /\\b2\\b/
          - searchbox ${quoted(EVERYONE_WORDS.search)}: ${tag}
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
      everyone(page).getByText(EVERYONE_WORDS.search, { exact: true }),
      "the search is a labelled field of its own again",
    ).toHaveCount(0);
    await passesTheAccessibilityGate();

    await skipLinkReachesThePage(page);
    await page.keyboard.press("o");
    await expect(outcomeOf(everyone(page))).toHaveText(/\S/);
    await expect(page.getByRole("dialog"), "a person opened with none in focus").toHaveCount(0);

    const listed = (await keystrokesListed(page, EVERYONE.name)).getByRole("definition");
    await expect(listed).toHaveText(listedFor(PEOPLE_KEYSTROKES));
    await page.keyboard.press("Escape");
    await expect(listed).toHaveCount(0);
    await expect(page.getByRole("button", { name: KEYSTROKE_WORDS.button })).toBeFocused();

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
  test("shows a person's workspaces, sessions and assistant access", async ({
    page,
    request,
    baseURL,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    const { operators, priya } = await priyaConnected(page, request, baseURL, tag);

    const sheet = await openPriya(page, tag);

    await expect(sheet.getByRole("heading", { level: 2, name: "Priya Shah" })).toBeFocused();
    await expect(sheet).toMatchAriaSnapshot(`
      - dialog "Priya Shah":
        - heading "Priya Shah" [level=2]
        - paragraph: ${priya.email}
        - region "Workspaces":
          - heading "Workspaces" [level=3]
          - list:
            - listitem: ${operators.name} Editor
        - region "Sign-In":
          - heading "Sign-In" [level=3]
          - term: Last Sign-In
          - definition: /\\d{2}:\\d{2} · \\d{1,2} [A-Z][a-z]+ \\d{4}/
          - term: Every Sign-In and Token Ended
          - definition: /^\\D+$/
        - region "Sessions":
          - heading "Sessions" [level=3]
          - paragraph: /\\b1\\b/
          - list:
            - /children: equal
            - listitem:
              - term: Began
              - definition: /\\d{4}/
              - term: Last Used
              - definition: /\\d{4}/
              - term: Expires
              - definition: /\\d{4}/
        - region "Assistant Access":
          - heading "Assistant Access" [level=3]
          - list:
            - listitem "Claude":
              - heading "Claude" [level=4]
              - term: Workspace
              - definition: ${operators.name}
              - term: Issued
              - definition: /\\d{4}/
              - term: Last Used
              - definition: /\\d{4}/
              - button "More About Claude’s Grant"
        - region "Display Name":
          - heading "Display Name" [level=3]
          - paragraph
          - button "Correct Display Name"
        - region "End Every Sign-In Everywhere":
          - heading "End Every Sign-In Everywhere" [level=3]
          - paragraph
          - button "${REVOKE}"
        - button "Close"
    `);
    for (const action of ["Correct Display Name", REVOKE]) {
      await expect(
        sheet.getByRole("button", { name: action }),
        `“${action}” does not say whom it acts on`,
      ).toHaveAccessibleDescription(/Priya Shah/);
    }
    await passesTheAccessibilityGate();

    const grant = regionOf(sheet, "Assistant Access").getByRole("listitem", { name: "Claude" });
    await expect(grant.getByText("Live", { exact: true })).toBeVisible();
    await grant.getByRole("button", { name: "More About Claude’s Grant" }).click();
    await expect(grant).toContainText("https://claude.ai/oauth/mcp-oauth-client-metadata");

    await page.keyboard.press("Escape");
    await expect(personButton(page, "Priya Shah")).toBeFocused();
  });

  test("shows a grant Claude disconnected as ended, naming no person", async ({
    page,
    request,
    baseURL,
  }) => {
    const tag = aTag();
    const { operators, refreshToken } = await priyaConnected(page, request, baseURL, tag);
    await claudeDisconnects(request, refreshToken);

    const sheet = await openPriya(page, tag);

    const grant = regionOf(sheet, "Assistant Access").getByRole("listitem", { name: "Claude" });
    await expect(grant).toMatchAriaSnapshot(`
      - listitem "Claude":
        - heading "Claude" [level=4]
        - term: Workspace
        - definition: ${operators.name}
        - term: Issued
        - definition: /\\d{4}/
        - term: Ended
        - definition: /\\d{4}/
        - term: Ended By
        - definition: /\\S/
        - term: Ended In
        - definition: ${operators.name}
        - button "More About Claude’s Grant"
    `);
    for (const someone of ["Priya Shah", operators.admin.name]) {
      await expect(grant, `the grant says ${someone} ended it`).not.toContainText(someone);
    }
  });

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
    // Ended in every workspace, so the last fact names no one workspace.
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

  test("sends a stale sign-in to sign in and back", async ({ page, request, baseURL }) => {
    const tag = aTag();
    const { operators } = await priyaConnected(page, request, baseURL, tag);
    await ageTheSignIn(request, operators.admin.id);
    const sheet = await openPriya(page, tag);

    await sheet.getByRole("button", { name: REVOKE }).click();
    const refused = refusalAnswering(page, "console.people.endEverySignInAndToken");
    await confirmationOf(page)
      .getByRole("button", { name: "End Every Sign-In Everywhere" })
      .click();

    expect(await refused).toMatchObject({ word: SIGN_IN_TOO_OLD });
    await saysARefusal(regionOf(sheet, "End Every Sign-In Everywhere").getByRole("alert"));
    await expect(sessionsOf(sheet)).toHaveCount(1);

    await sheet.getByRole("link", { name: "Sign in again" }).click();
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);
    await signIn(page, request, operators.admin.email);

    await expect(page).toHaveURL(new RegExp(`${EVERYONE_PAGE}\\?`));
    const again = sheetOf(page, "Priya Shah");
    const revoke = again.getByRole("button", { name: REVOKE });
    await expect(revoke).toBeFocused();
    await revoke.press("Enter");
    await confirmationOf(page)
      .getByRole("button", { name: "End Every Sign-In Everywhere" })
      .click();
    await expect(regionOf(again, "End Every Sign-In Everywhere").getByRole("status")).toHaveText(
      ENDED_AT,
    );
    await expect(sessionsOf(again)).toHaveCount(0);

    // The way back has served once the person is closed, so a reload does not reopen them.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(EVERYONE_PAGE);
    await expect(personButton(page, "Priya Shah")).toBeFocused();
  });

  test("ends the focused person's sign-ins by keyboard alone", async ({
    page,
    request,
    baseURL,
  }) => {
    const tag = aTag();
    await priyaConnected(page, request, baseURL, tag);
    await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
    await expect(personRows(page)).toHaveCount(2);

    await personButton(page, "Priya Shah").focus();
    await page.keyboard.press("r");
    const sheet = sheetOf(page, "Priya Shah");
    await expect(sheet.getByRole("button", { name: REVOKE })).toBeFocused();

    await page.keyboard.press("Enter");
    const confirmation = confirmationOf(page);
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      confirmation.getByRole("button", { name: "End Every Sign-In Everywhere" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(regionOf(sheet, "End Every Sign-In Everywhere").getByRole("status")).toHaveText(
      ENDED_AT,
    );
    await expect(sessionsOf(sheet)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(personButton(page, "Priya Shah")).toBeFocused();
  });

  test("corrects a display name from the sheet, within its budget", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await priyaListed(page, request, aTag());
    await personButton(page, "Priya Shah").click();
    const correct = regionOf(sheetOf(page, "Priya Shah"), "Display Name").getByRole("button", {
      name: "Correct Display Name",
    });

    const dialog = await correctingCancelled(page, correct, "Priya Shah", {
      audit: passesTheAccessibilityGate,
    });

    await correct.click();
    await nameFieldOf(dialog).fill("Priya Sharma");
    await clockTheNextKey(page, {
      at: "(//div[@role='dialog'][.//h3[normalize-space(.)='Display Name']]//h2)[1]",
      reads: "Priya Sharma",
    });
    await page.keyboard.press("Enter");

    const renamed = sheetOf(page, "Priya Sharma");
    await expect(renamed.getByRole("heading", { level: 2 })).toHaveText("Priya Sharma");
    await theActionLandedWithinItsBudget(page, "correct display name");
    await savedInTheSheet(renamed);

    await page.keyboard.press("Escape");
    await expect(personButton(page, "Priya Sharma")).toBeFocused();
    await page.reload();
    await expect(personButton(page, "Priya Sharma")).toBeVisible();
  });

  test("keeps a sheet open when its person leaves the search", async ({ page, request }) => {
    const tag = aTag();
    await signedInAsTheOperator(page, request, tag);
    const flagged = `Priya ${tag}`;
    await person(request, anAddress("priya"), { displayName: flagged });
    await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
    await personButton(page, flagged).click();
    const correct = regionOf(sheetOf(page, flagged), "Display Name").getByRole("button", {
      name: "Correct Display Name",
    });

    await correct.click();
    await nameFieldOf(dialogToCorrect(page, flagged)).fill("Priya Shah");
    await page.keyboard.press("Enter");

    // Behind the sheet, so read with what it hides: the list, read again, holds the operator alone.
    await expect(
      page
        .getByRole("region", { name: EVERYONE_WORDS.heading, includeHidden: true })
        .getByRole("status", { includeHidden: true })
        .first(),
    ).toHaveText(/\b1\b/);
    await savedInTheSheet(sheetOf(page, "Priya Shah"));
    await page.keyboard.press("Escape");
    await expect(searchBox(page)).toBeFocused();
  });

  test("corrects after a stale sign-in's round trip, from the sheet", async ({ page, request }) => {
    const { operators } = await priyaListed(page, request, aTag());
    await ageTheSignIn(request, operators.admin.id);
    await personButton(page, "Priya Shah").click();
    const part = regionOf(sheetOf(page, "Priya Shah"), "Display Name");
    await part.getByRole("button", { name: "Correct Display Name" }).click();
    await nameFieldOf(dialogToCorrect(page, "Priya Shah")).fill("Priya Sharma");
    const refused = refusalAnswering(page, CORRECT_A_NAME);
    await page.keyboard.press("Enter");

    expect(await refused).toMatchObject({ word: SIGN_IN_TOO_OLD });
    await saysARefusal(part.getByRole("alert"));
    await part.getByRole("link", { name: "Sign in again" }).click();
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);
    await signIn(page, request, operators.admin.email);

    const again = regionOf(sheetOf(page, "Priya Shah"), "Display Name").getByRole("button", {
      name: "Correct Display Name",
    });
    await expect(again).toBeFocused();
    await again.press("Enter");
    await nameFieldOf(dialogToCorrect(page, "Priya Shah")).fill("Priya Sharma");
    await page.keyboard.press("Enter");
    await expect(
      regionOf(sheetOf(page, "Priya Sharma"), "Display Name").getByRole("status"),
    ).toHaveText(/\S/);
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

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto(NAMES_WAITING_PAGE);
    await expect(waitingRowOf(page, name)).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "names waiting list", description: `${elapsed} ms` });
    expect(elapsed, "the names waiting rendered past their budget").toBeLessThan(LIST_BUDGET_MS);

    // Every name the run flags waits here, so the page is read narrowed to this test's own.
    await waitingSearch(page).fill(name);
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(thePage(page)).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${quoted(PEOPLE.name)} [level=1]
        - paragraph
        - region ${quoted(NAMES_WAITING_WORDS.heading)}:
          - heading ${quoted(NAMES_WAITING_WORDS.heading)} [level=2]
          - paragraph
          - status: /\\b1\\b/
          - searchbox ${quoted(NAMES_WAITING_WORDS.search)}: ${quoted(name)}
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
                  - button ${quoted(correctWords(name))}
    `);
  });

  test("says what Names Waiting is, apart from Everyone", async ({ page, request }) => {
    await signedInAsTheOperator(page, request, aTag());
    await page.goto(NAMES_WAITING_PAGE);

    // A page's line follows its heading, and a list's description its own.
    const summary = thePage(page).locator("h1 + p");
    const descriptions = thePage(page).locator("h2 + p");
    await expect(summary).toHaveText(/\S/);
    await expect(namesWaiting(page).locator("h2 + p")).toHaveText(/\S/);
    await expect(descriptions, "Names Waiting describes more than itself").toHaveCount(1);
    const theGroups = await summary.innerText();
    const ofNamesWaiting = await descriptions.innerText();

    await navOf(page, CONSOLE).getByRole("link", { name: EVERYONE.name }).click();
    await expect(everyone(page).locator("h2 + p")).toHaveText(/\S/);
    await expect(descriptions, "Everyone describes more than itself").toHaveCount(1);
    await expect(descriptions, "Everyone is described as Names Waiting is").not.toHaveText(
      ofNamesWaiting,
    );
    await expect(summary, "the two pages of one group lead with different lines").toHaveText(
      theGroups,
    );
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

    // Her own name holds no word of the workspace that flagged it.
    await waitingSearch(page).fill(operators.name);
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(waitingRowOf(page, name)).toBeVisible();

    const nobody = `nobody ${tag}`;
    await waitingSearch(page).fill(nobody);
    await expect(waitingCount(page)).toHaveText(/\b0\b/);
    // The one row left is the list's own, saying none match and offering to clear.
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(waitingRows(page).getByRole("button")).toHaveText([CLEAR_WORDS.search]);
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

  test("keeps Names Waiting's search and focus through a refused re-read", async ({
    page,
    context,
    request,
  }) => {
    await signedInAsTheOperator(page, request, aTag());
    await page.goto(NAMES_WAITING_PAGE);
    await expect(namesWaiting(page).getByRole("table")).toBeVisible();
    await waitingSearch(page).fill("priya");
    await expect(waitingSearch(page)).toBeFocused();

    await refusedFromNowOn(page, "console.people.namesWaiting");
    const refused = refusalAnswering(page, "console.people.namesWaiting");
    // The query library reads every list again as the network comes back.
    await context.setOffline(true);
    await context.setOffline(false);

    expect(await refused).toMatchObject({ word: NOT_THE_OPERATOR });
    await expect(namesWaiting(page).getByRole("table")).toHaveCount(0);
    await saysOfItsRead(namesWaiting(page));
    await expect(waitingSearch(page)).toBeVisible();
    await expect(waitingSearch(page)).toBeFocused();
    await expect(waitingSearch(page)).toHaveValue("priya");
  });

  test("corrects a name behind a confirmation, within its budget", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    const { name } = await priyaFlagged(page, request, tag);
    const corrected = `Priya Sharma ${tag}`;
    await page.goto(NAMES_WAITING_PAGE);
    const correct = correctButtonOf(page, name);

    const dialog = await correctingCancelled(page, correct, name, {
      audit: passesTheAccessibilityGate,
    });

    await correct.click();
    await nameFieldOf(dialog).fill(corrected);
    await clockTheRowLeaving(page, name);
    await page.keyboard.press("Enter");

    await expect(waitingRowOf(page, name)).toHaveCount(0);
    await theActionLandedWithinItsBudget(page, "correct display name");
    await expect(outcomeOf(namesWaiting(page))).toHaveText(/\S/);
    await expect(namesWaiting(page).getByRole("heading", { name: "Names Waiting" })).toBeFocused();

    await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
    await expect(personButton(page, corrected)).toBeVisible();
    await page.goto(NAMES_WAITING_PAGE);
    // The count stands empty until the list is read.
    await expect(waitingCount(page)).toHaveText(/\S/);
    await expect(waitingRowOf(page, name)).toHaveCount(0);
  });

  test("refuses a name the rule forbids, in the rule's words", async ({ page, request }) => {
    const { name } = await priyaFlagged(page, request, aTag());
    await page.goto(NAMES_WAITING_PAGE);
    await correctButtonOf(page, name).click();
    const dialog = dialogToCorrect(page, name);
    await nameFieldOf(dialog).fill("Priya <priya@acme.invalid>");
    const refused = refusalAnswering(page, CORRECT_A_NAME);
    await dialog.getByRole("button", { name: "Save Changes" }).click();

    expect(await refused).toMatchObject({ word: "display-name-angle-bracket" });
    const alert = namesWaiting(page).getByRole("alert");
    await saysARefusal(alert);
    const said = await alert.innerText();
    await expect(correctButtonOf(page, name)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(nameFieldOf(dialog)).toHaveValue("Priya <priya@acme.invalid>");
    await expect(nameFieldOf(dialog)).toHaveAttribute("aria-invalid", "true");
    await expect(nameFieldOf(dialog)).toHaveAccessibleDescription(
      new RegExp(`${asWritten(said)}$`),
    );
  });

  test("corrects a name after a stale sign-in's round trip", async ({ page, request }) => {
    const tag = aTag();
    const { operators, name } = await priyaFlagged(page, request, tag);
    const corrected = `Priya Sharma ${tag}`;
    await ageTheSignIn(request, operators.admin.id);
    await page.goto(NAMES_WAITING_PAGE);
    await correctButtonOf(page, name).click();
    await nameFieldOf(dialogToCorrect(page, name)).fill(corrected);
    const refused = refusalAnswering(page, CORRECT_A_NAME);
    await page.keyboard.press("Enter");

    expect(await refused).toMatchObject({ word: SIGN_IN_TOO_OLD });
    await saysARefusal(namesWaiting(page).getByRole("alert"));
    await expect(waitingRowOf(page, name)).toBeVisible();
    const signInAgain = namesWaiting(page).getByRole("link", { name: "Sign in again" });
    await expect(signInAgain).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);
    await signIn(page, request, operators.admin.email);

    await expect(page).toHaveURL(new RegExp(`${NAMES_WAITING_PAGE}\\?`));
    const again = correctButtonOf(page, name);
    await expect(again).toBeFocused();
    await again.press("Enter");
    await nameFieldOf(dialogToCorrect(page, name)).fill(corrected);
    await page.keyboard.press("Enter");
    await expect(waitingRowOf(page, name)).toHaveCount(0);
    await expect(outcomeOf(namesWaiting(page))).toHaveText(/\S/);
    // The way back has served once the name is corrected, so a reload lands nowhere in particular.
    await expect(page).toHaveURL(NAMES_WAITING_PAGE);
  });

  test("is keyboard-operable and lists its keystrokes", async ({ page, request }) => {
    const { name } = await priyaFlagged(page, request, aTag());
    await page.goto(NAMES_WAITING_PAGE);
    await expect(waitingRowOf(page, name)).toBeVisible();

    await skipLinkReachesThePage(page);
    await page.keyboard.press("c");
    await expect(outcomeOf(namesWaiting(page))).toHaveText(/\S/);
    await expect(page.getByRole("dialog"), "a name opened with none in focus").toHaveCount(0);
    const listed = await keystrokesListed(page, NAMES_WAITING.name);
    await expect(listed.getByRole("definition")).toHaveText(listedFor(NAMES_WAITING_KEYSTROKES));
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
