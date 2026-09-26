import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { KEYSTROKE_WORDS, SELECT_FIRST } from "@/shared/keystroke-words.ts";
import { consoleScreenById, viewNamed } from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  ageTheSignIn,
  anAddress,
  aPkcePair,
  catchClaudesRedirect,
  CLAUDES_REDIRECT_URI,
  claudeExchanges,
  claudesAuthorizeUrl,
  clockTheNextKey,
  flagTheName,
  keystrokesDismissed,
  keystrokesListed,
  markTheOperator,
  person,
  provision,
  signedInAtHome,
  signIn,
  skipLinkReachesTheScreen,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

/** Where the console's People screen opens. */
const EVERYONE_VIEW = consoleScreenById("people").defaultView;

const NAMES_WAITING_VIEW = viewNamed(consoleScreenById("people"), "Names waiting").path;

/** Written once, so an aria snapshot can set it after a workspace's name. */
const INSTANT_WORDS = String.raw`\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}`;

const INSTANT = new RegExp(`^${INSTANT_WORDS}$`);

const REVOKE = "Revoke Priya Shah's credentials everywhere";

/** Everyone the run makes is on this list, so a test finds its own by a tag in their address. */
const aTag = (): string => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const railOf = (page: Page) => page.getByRole("navigation", { name: "Console" });

const everyone = (page: Page) => page.getByRole("region", { name: "Everyone" });

const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search by name or address" });

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

const confirmationOf = (page: Page): Locator => page.getByRole("dialog", { name: REVOKE });

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

  await claudeExchanges(api, { origin, code, verifier });
  await page.unroute(`${CLAUDES_REDIRECT_URI}*`);
  await page.context().clearCookies();
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
  await claudeConnectedAs(page, api, originOf(baseURL), priya.email);
  await signedInAtHome(page, api, operators.admin.email);
  return { operators, priya };
};

const openPriya = async (page: Page, tag: string): Promise<Locator> => {
  await page.goto(`${EVERYONE_VIEW}?search=${tag}`);
  await personButton(page, "Priya Shah").click();
  const sheet = sheetOf(page, "Priya Shah");
  await expect(regionOf(sheet, "Sessions")).toContainText("1 session open.");
  return sheet;
};

const dialogToCorrect = (page: Page, name: string): Locator =>
  page.getByRole("dialog", { name: `Correct ${name}'s display name` });

const nameFieldOf = (dialog: Locator): Locator =>
  dialog.getByRole("textbox", { name: "Display name" });

/**
 * The act opens on the name as it stands, under the rule and the consequence; Cancel hands focus
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
  await expect(dialog).toContainText("the rule a person's own name follows");
  await expect(dialog).toContainText("in every workspace they belong to");
  await asked.audit();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(correct).toBeFocused();
  return dialog;
};

const namesWaiting = (page: Page) => page.getByRole("region", { name: "Names waiting" });

/** The count, told apart by its words from the act's own status beside it. */
const waitingCount = (page: Page): Locator =>
  namesWaiting(page).getByRole("status").filter({ hasText: "to be corrected." });

/** Every name the run flags waits on this list, so a test's own name carries its tag. */
const waitingRowOf = (page: Page, name: string): Locator =>
  namesWaiting(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });

const correctButtonOf = (page: Page, name: string): Locator =>
  waitingRowOf(page, name).getByRole("button", { name: `Correct ${name}'s display name` });

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
    at: `//section[h2[normalize-space(.)='Names waiting']][not(.//td[normalize-space(.)='${name}'])]`,
    reads: "Names waiting",
  });

/** The operator lands on Everyone, searched for her. */
const priyaListed = async (page: Page, api: APIRequestContext, tag: string) => {
  const held = await priyaWithTheOperator(page, api, { tag, displayName: "Priya Shah" });
  await page.goto(`${EVERYONE_VIEW}?search=${tag}`);
  return held;
};

/** The saved name's words, which the view and the sheet both say. */
const savedWords = (was: string, now: string): string =>
  `Saved: ${was}'s display name is ${now} now, wherever the platform names them.`;

test.describe("the console's Everyone view", () => {
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

    await page.goto(`${EVERYONE_VIEW}?search=${tag}`);

    await expect(personRows(page)).toHaveCount(3);
    await expect(everyone(page).getByRole("status").first()).toHaveText(`3 people match “${tag}”.`);
    const theirs = rowOf(page, "Priya Shah");
    await expect(theirs).toContainText(priya.email);
    await expect(theirs.getByRole("cell").nth(1).getByRole("listitem")).toHaveText([
      `${beta.name} Viewer`,
      `${operators.name} Editor`,
    ]);
    await expect(theirs.getByRole("cell").nth(2)).toHaveText("None on record");
    await expect(rowOf(page, "Sam Okoro").getByRole("cell").nth(1)).toHaveText("No workspace");
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
    await page.goto(EVERYONE_VIEW);

    await searchBox(page).fill(tag.toUpperCase());
    await expect(personRows(page)).toHaveCount(3);
    await expect(everyone(page)).toContainText(`3 people match “${tag.toUpperCase()}”.`);

    await searchBox(page).fill(`hartley ${tag}`);
    await expect(personRows(page)).toHaveCount(1);
    await expect(rowOf(page, `Ada Hartley ${tag}`)).toBeVisible();
    await expect(everyone(page)).toContainText(`1 person matches “hartley ${tag}”.`);

    await searchBox(page).fill(`nobody ${tag}`);
    await expect(everyone(page)).toContainText(`No one matches “nobody ${tag}”.`);
    await expect(personRows(page)).toHaveCount(1);
    await passesTheAccessibilityGate();
    await everyone(page).getByRole("button", { name: "Clear the search" }).click();

    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page)).toBeFocused();
    await expect(everyone(page)).toContainText("on the platform.");
  });

  test("pages through more people than one page holds", async ({ page, request }) => {
    await signedInAsTheOperator(page, request, aTag());
    const tag = aTag();
    for (let made = 0; made < 51; made += 1) {
      await person(request, anAddress(`${tag}-${made}`), { displayName: `Person ${made}` });
    }

    await page.goto(`${EVERYONE_VIEW}?search=${tag}`);

    const paging = everyone(page).getByRole("navigation", { name: "Pages of people" });
    await expect(personRows(page)).toHaveCount(50);
    await expect(paging).toContainText("Showing 1–50 of 51.");
    await expect(paging.getByRole("button", { name: "Previous page" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const next = paging.getByRole("button", { name: "Next page" });
    await next.click();
    await expect(personRows(page)).toHaveCount(1);
    await expect(paging).toContainText("Showing 51–51 of 51.");
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();

    await paging.getByRole("button", { name: "Previous page" }).click();
    await expect(personRows(page)).toHaveCount(50);

    await page.keyboard.press("n");
    await expect(paging).toContainText("Showing 51–51 of 51.");
    await page.keyboard.press("n");
    await expect(everyone(page)).toContainText("This is the last page of people.");
    await page.keyboard.press("p");
    await expect(paging).toContainText("Showing 1–50 of 51.");
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await signedInAsTheOperator(page, request, aTag());

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto(EVERYONE_VIEW);
    await expect(personRows(page).first()).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "everyone list", description: `${elapsed} ms` });
    expect(elapsed, "the first page of everyone rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  test("shows the api's refusal once the mark clears", async ({ page, request }) => {
    const tag = aTag();
    const operators = await signedInAsTheOperator(page, request, tag);
    await page.goto(`${EVERYONE_VIEW}?search=${tag}`);
    await expect(personRows(page)).toHaveCount(1);

    await markTheOperator(request, operators.admin.email, "revoke");
    // A move between the console's own screens keeps its standing, so the list asks again alone.
    await railOf(page).getByRole("link", { name: "Workspaces" }).click();
    await railOf(page).getByRole("link", { name: "People" }).click();

    await expect(everyone(page)).toContainText(
      "Refused: not-the-operator. Only the operator may open the console. Go back to your workspaces.",
    );
    await expect(everyone(page).getByRole("table")).toHaveCount(0);
  });

  test("is keyboard-operable, sounds like a table and passes axe", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    const operators = await signedInAsTheOperator(page, request, tag);
    await person(request, anAddress(`${tag}-priya`), { displayName: "Priya Shah" });
    await page.goto(`${EVERYONE_VIEW}?search=${tag}`);
    await expect(personRows(page)).toHaveCount(2);

    await expect(everyone(page)).toMatchAriaSnapshot(`
      - region "Everyone":
        - heading "Everyone" [level=2]
        - status: 2 people match “${tag}”.
        - searchbox "Search by name or address": ${tag}
        - table:
          - caption: /Every person on the platform/
          - rowgroup:
            - row "Person Workspaces and roles Last sign-in":
              - columnheader "Person"
              - columnheader "Workspaces and roles"
              - columnheader "Last sign-in"
          - rowgroup:
            - row /Priya Shah/:
              - cell /Priya Shah/:
                - button "Priya Shah"
              - cell "No workspace"
              - cell "None on record"
            - row /Test person/:
              - cell /Test person/:
                - button "Test person"
              - cell "${operators.name} Admin":
                - list:
                  - listitem: ${operators.name} Admin
              - cell /\\d{2}:\\d{2} · \\d{1,2} [A-Z][a-z]+ \\d{4}/
    `);
    await passesTheAccessibilityGate();

    await skipLinkReachesTheScreen(page);
    await page.keyboard.press("o");
    await expect(everyone(page)).toContainText(SELECT_FIRST.person);

    const listed = (await keystrokesListed(page, "People")).getByRole("definition");
    await expect(listed).toHaveText([
      "Search everyone by name or address",
      "Open the person in focus",
      "Revoke the credentials of the person in focus",
      "Correct the display name of the person in focus",
      "Show the previous page of people",
      "Show the next page of people",
      KEYSTROKE_WORDS.showTheList,
    ]);
    await page.keyboard.press("Escape");
    await expect(listed).toHaveCount(0);
    // The list hands focus back to its button as its exit ends; a key sent sooner goes astray.
    await expect(page.getByRole("button", { name: KEYSTROKE_WORDS.button })).toBeFocused();

    await page.keyboard.press("/");
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(searchBox(page)).toHaveValue("");
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
      sheetOf(page, "Priya Shah").getByRole("button", {
        name: "Correct Priya Shah's display name",
      }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(priya).toBeFocused();
  });
});

test.describe("a person, opened from Everyone as a sheet", () => {
  test("shows a person's workspaces, sessions and client grants", async ({
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
        - region "Sign-in":
          - heading "Sign-in" [level=3]
          - term: Last sign-in
          - definition: /\\d{2}:\\d{2} · \\d{1,2} [A-Z][a-z]+ \\d{4}/
          - term: Credentials revoked
          - definition: Never
        - region "Sessions":
          - heading "Sessions" [level=3]
          - paragraph: 1 session open. Revoking credentials ends every one at once.
          - list:
            - listitem:
              - term: Began
              - definition: /\\d{4}/
              - term: Last used
              - definition: /\\d{4}/
              - term: Expires
              - definition: /\\d{4}/
        - region "Client grants":
          - heading "Client grants" [level=3]
          - list:
            - listitem "Claude":
              - heading "Claude" [level=4]
              - text: Live
              - term: Workspace
              - definition: ${operators.name}
              - term: Issued
              - definition: /\\d{4}/
              - term: Last used
              - definition: /\\d{4}/
              - button "More about Claude's grant"
        - region "Display name":
          - heading "Display name" [level=3]
          - paragraph: /Replaces Priya Shah's display name in every workspace they belong to/
          - button "Correct Priya Shah's display name"
        - region "Revoke everywhere":
          - heading "Revoke everywhere" [level=3]
          - paragraph: /Ends every session and client grant Priya Shah holds/
          - button "${REVOKE}"
        - button "Close"
    `);
    await passesTheAccessibilityGate();

    const grant = regionOf(sheet, "Client grants").getByRole("listitem", { name: "Claude" });
    await grant.getByRole("button", { name: "More about Claude's grant" }).click();
    await expect(grant).toContainText("https://claude.ai/oauth/mcp-oauth-client-metadata");

    await page.keyboard.press("Escape");
    await expect(personButton(page, "Priya Shah")).toBeFocused();
  });

  test("revokes everywhere behind a confirmation, within its budget", async ({
    page,
    request,
    baseURL,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    await priyaConnected(page, request, baseURL, tag);
    const sheet = await openPriya(page, tag);
    const revoke = sheet.getByRole("button", { name: REVOKE });
    const grant = regionOf(sheet, "Client grants").getByRole("listitem", { name: "Claude" });
    await expect(grant).toBeVisible();

    await revoke.click();
    const confirmation = confirmationOf(page);
    await expect(confirmation).toContainText(
      "Every session and client grant Priya Shah holds ends now, in every workspace",
    );
    await passesTheAccessibilityGate();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(revoke).toBeFocused();
    await expect(regionOf(sheet, "Sessions")).toContainText("1 session open.");

    await revoke.click();
    await confirmation.getByRole("button", { name: "Revoke everywhere" }).focus();
    await clockTheNextKey(page, {
      at: "//section[h3[normalize-space(.)='Sessions']]",
      reads: "No session is open.",
    });
    await page.keyboard.press("Enter");

    await expect(regionOf(sheet, "Sessions")).toContainText("No session is open.");
    await theActLandedWithinItsBudget(page, "revoke everywhere");
    await expect(regionOf(sheet, "Revoke everywhere").getByRole("status")).toHaveText(
      /^Priya Shah's sessions and client grants ended at \d{2}:\d{2} · .+\. They can sign in again\.$/,
    );
    await expect(revoke).toBeFocused();
    await expect(grant).toHaveCount(0);
    await expect(regionOf(sheet, "Sign-in").getByRole("definition").nth(1)).toHaveText(INSTANT);

    await page.reload();
    await personButton(page, "Priya Shah").click();
    await expect(regionOf(sheet, "Sessions")).toContainText("No session is open.");
    await expect(grant).toHaveCount(0);
  });

  test("sends a stale sign-in to sign in and back", async ({ page, request, baseURL }) => {
    const tag = aTag();
    const { operators } = await priyaConnected(page, request, baseURL, tag);
    await ageTheSignIn(request, operators.admin.id);
    const sheet = await openPriya(page, tag);

    await sheet.getByRole("button", { name: REVOKE }).click();
    await confirmationOf(page).getByRole("button", { name: "Revoke everywhere" }).click();

    const refused = regionOf(sheet, "Revoke everywhere").getByRole("alert");
    await expect(refused).toContainText("Refused: sign-in-too-old.");
    await expect(refused).toContainText("Your sign-in is more than an hour old");
    await expect(regionOf(sheet, "Sessions")).toContainText("1 session open.");

    await sheet.getByRole("link", { name: "Sign in again" }).click();
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);
    await signIn(page, request, operators.admin.email);

    await expect(page).toHaveURL(new RegExp(`${EVERYONE_VIEW}\\?`));
    const again = sheetOf(page, "Priya Shah");
    const revoke = again.getByRole("button", { name: REVOKE });
    await expect(revoke).toBeFocused();
    await revoke.press("Enter");
    await confirmationOf(page).getByRole("button", { name: "Revoke everywhere" }).click();
    await expect(regionOf(again, "Revoke everywhere").getByRole("status")).toContainText(
      "sessions and client grants ended",
    );
    await expect(regionOf(again, "Sessions")).toContainText("No session is open.");

    // The way back has served once the person is closed, so a reload does not reopen them.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(EVERYONE_VIEW);
    await expect(personButton(page, "Priya Shah")).toBeFocused();
  });

  test("revokes the person in focus by keyboard alone", async ({ page, request, baseURL }) => {
    const tag = aTag();
    await priyaConnected(page, request, baseURL, tag);
    await page.goto(`${EVERYONE_VIEW}?search=${tag}`);
    await expect(personRows(page)).toHaveCount(2);

    await personButton(page, "Priya Shah").focus();
    await page.keyboard.press("r");
    const sheet = sheetOf(page, "Priya Shah");
    await expect(sheet.getByRole("button", { name: REVOKE })).toBeFocused();

    await page.keyboard.press("Enter");
    const confirmation = confirmationOf(page);
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirmation.getByRole("button", { name: "Revoke everywhere" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(regionOf(sheet, "Revoke everywhere").getByRole("status")).toContainText(
      "sessions and client grants ended",
    );
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
    const correct = regionOf(sheetOf(page, "Priya Shah"), "Display name").getByRole("button", {
      name: "Correct Priya Shah's display name",
    });

    const dialog = await correctingCancelled(page, correct, "Priya Shah", {
      audit: passesTheAccessibilityGate,
    });

    await correct.click();
    await nameFieldOf(dialog).fill("Priya Sharma");
    await clockTheNextKey(page, {
      at: "(//div[@role='dialog'][.//h3[normalize-space(.)='Display name']]//h2)[1]",
      reads: "Priya Sharma",
    });
    await page.keyboard.press("Enter");

    const renamed = sheetOf(page, "Priya Sharma");
    await expect(renamed.getByRole("heading", { level: 2 })).toHaveText("Priya Sharma");
    await theActLandedWithinItsBudget(page, "correct display name");
    const part = regionOf(renamed, "Display name");
    await expect(part.getByRole("status")).toHaveText(savedWords("Priya Shah", "Priya Sharma"));
    await expect(
      part.getByRole("button", { name: "Correct Priya Sharma's display name" }),
    ).toBeFocused();

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
    await page.goto(`${EVERYONE_VIEW}?search=${tag}`);
    await personButton(page, flagged).click();
    const correct = regionOf(sheetOf(page, flagged), "Display name").getByRole("button", {
      name: `Correct ${flagged}'s display name`,
    });

    await correct.click();
    await nameFieldOf(dialogToCorrect(page, flagged)).fill("Priya Shah");
    await page.keyboard.press("Enter");

    // Behind the sheet, so read as text: the list, read again, holds the operator alone.
    await expect(page.getByText(`1 person matches “${tag}”.`)).toBeVisible();
    const part = regionOf(sheetOf(page, "Priya Shah"), "Display name");
    await expect(part.getByRole("status")).toHaveText(savedWords(flagged, "Priya Shah"));
    await expect(
      part.getByRole("button", { name: "Correct Priya Shah's display name" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(searchBox(page)).toBeFocused();
  });

  test("corrects after a stale sign-in's round trip, from the sheet", async ({ page, request }) => {
    const { operators } = await priyaListed(page, request, aTag());
    await ageTheSignIn(request, operators.admin.id);
    await personButton(page, "Priya Shah").click();
    const part = regionOf(sheetOf(page, "Priya Shah"), "Display name");
    await part.getByRole("button", { name: "Correct Priya Shah's display name" }).click();
    await nameFieldOf(dialogToCorrect(page, "Priya Shah")).fill("Priya Sharma");
    await page.keyboard.press("Enter");

    await expect(part.getByRole("alert")).toContainText("Refused: sign-in-too-old.");
    await expect(part.getByRole("alert")).toContainText("Your sign-in is more than an hour old");
    await part.getByRole("link", { name: "Sign in again" }).click();
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);
    await signIn(page, request, operators.admin.email);

    const again = regionOf(sheetOf(page, "Priya Shah"), "Display name").getByRole("button", {
      name: "Correct Priya Shah's display name",
    });
    await expect(again).toBeFocused();
    await again.press("Enter");
    await nameFieldOf(dialogToCorrect(page, "Priya Shah")).fill("Priya Sharma");
    await page.keyboard.press("Enter");
    await expect(
      regionOf(sheetOf(page, "Priya Sharma"), "Display name").getByRole("status"),
    ).toHaveText(savedWords("Priya Shah", "Priya Sharma"));
  });
});

test.describe("the console's Names waiting view", () => {
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
    await page.goto(NAMES_WAITING_VIEW);
    await expect(waitingRowOf(page, name)).toBeVisible();
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "names waiting list", description: `${elapsed} ms` });
    expect(elapsed, "the names waiting rendered past their budget").toBeLessThan(LIST_BUDGET_MS);
    await expect(namesWaiting(page)).toMatchAriaSnapshot(`
      - region "Names waiting":
        - heading "Names waiting" [level=2]
        - paragraph: /the longest waiting first/
        - status: /^\\d+ names? waits? to be corrected\\.$/
        - table:
          - caption: /Every display name an Admin flagged/
          - rowgroup:
            - row "Person Flagged by Acts":
              - columnheader "Person"
              - columnheader "Flagged by"
              - columnheader "Acts"
          - rowgroup:
            - row /${name}/:
              - cell "${name}"
              - cell:
                - list:
                  - listitem: /^${operators.name} ${INSTANT_WORDS}$/
                  - listitem: /^Beta ${tag} ${INSTANT_WORDS}$/
              - cell:
                - button "Correct ${name}'s display name"
    `);
  });

  test("corrects a name behind a confirmation, within its budget", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    const { name } = await priyaFlagged(page, request, tag);
    const corrected = `Priya Sharma ${tag}`;
    await page.goto(NAMES_WAITING_VIEW);
    const correct = correctButtonOf(page, name);

    const dialog = await correctingCancelled(page, correct, name, {
      audit: passesTheAccessibilityGate,
    });

    await correct.click();
    await nameFieldOf(dialog).fill(corrected);
    await clockTheRowLeaving(page, name);
    await page.keyboard.press("Enter");

    await expect(waitingRowOf(page, name)).toHaveCount(0);
    await theActLandedWithinItsBudget(page, "correct display name");
    await expect(namesWaiting(page)).toContainText(savedWords(name, corrected));
    await expect(namesWaiting(page).getByRole("heading", { name: "Names waiting" })).toBeFocused();

    await page.goto(`${EVERYONE_VIEW}?search=${tag}`);
    await expect(personButton(page, corrected)).toBeVisible();
    await page.goto(NAMES_WAITING_VIEW);
    await expect(waitingCount(page)).toBeVisible();
    await expect(waitingRowOf(page, name)).toHaveCount(0);
  });

  test("refuses a name the rule forbids, in the rule's words", async ({ page, request }) => {
    const { name } = await priyaFlagged(page, request, aTag());
    const refusal =
      "Refused: display-name-angle-bracket. A display name cannot hold < or >. Remove them and save again.";
    await page.goto(NAMES_WAITING_VIEW);
    await correctButtonOf(page, name).click();
    const dialog = dialogToCorrect(page, name);
    await nameFieldOf(dialog).fill("Priya <priya@acme.invalid>");
    await dialog.getByRole("button", { name: "Save the name" }).click();

    await expect(namesWaiting(page).getByRole("alert")).toHaveText(refusal);
    await expect(correctButtonOf(page, name)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(nameFieldOf(dialog)).toHaveValue("Priya <priya@acme.invalid>");
    await expect(nameFieldOf(dialog)).toHaveAttribute("aria-invalid", "true");
    await expect(nameFieldOf(dialog)).toHaveAccessibleDescription(new RegExp(`${refusal}$`));
  });

  test("corrects a name after a stale sign-in's round trip", async ({ page, request }) => {
    const tag = aTag();
    const { operators, name } = await priyaFlagged(page, request, tag);
    const corrected = `Priya Sharma ${tag}`;
    await ageTheSignIn(request, operators.admin.id);
    await page.goto(NAMES_WAITING_VIEW);
    await correctButtonOf(page, name).click();
    await nameFieldOf(dialogToCorrect(page, name)).fill(corrected);
    await page.keyboard.press("Enter");

    const refused = namesWaiting(page).getByRole("alert");
    await expect(refused).toContainText("Refused: sign-in-too-old.");
    await expect(refused).toContainText("Your sign-in is more than an hour old");
    await expect(waitingRowOf(page, name)).toBeVisible();
    const signInAgain = namesWaiting(page).getByRole("link", { name: "Sign in again" });
    await expect(signInAgain).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);
    await signIn(page, request, operators.admin.email);

    await expect(page).toHaveURL(new RegExp(`${NAMES_WAITING_VIEW}\\?`));
    const again = correctButtonOf(page, name);
    await expect(again).toBeFocused();
    await again.press("Enter");
    await nameFieldOf(dialogToCorrect(page, name)).fill(corrected);
    await page.keyboard.press("Enter");
    await expect(waitingRowOf(page, name)).toHaveCount(0);
    await expect(namesWaiting(page)).toContainText(savedWords(name, corrected));
    // The way back has served once the name is corrected, so a reload lands nowhere in particular.
    await expect(page).toHaveURL(NAMES_WAITING_VIEW);
  });

  test("is keyboard-operable and lists its keystrokes", async ({ page, request }) => {
    const { name } = await priyaFlagged(page, request, aTag());
    await page.goto(NAMES_WAITING_VIEW);
    await expect(waitingRowOf(page, name)).toBeVisible();

    await skipLinkReachesTheScreen(page);
    await page.keyboard.press("c");
    await expect(namesWaiting(page)).toContainText(SELECT_FIRST.name);
    const listed = await keystrokesListed(page, "People");
    await expect(listed.getByRole("definition")).toHaveText([
      "Correct the display name in focus",
      KEYSTROKE_WORDS.showTheList,
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
