import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { EVERYONE_PATH } from "@/features/console/people-address.ts";
import { PERSON_WORDS } from "@/features/console/words.ts";

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
  markTheOperator,
  person,
  provision,
  signedInAtHome,
  signIn,
  actionWithinBudget,
} from "../harness.ts";
import { personButton, sheetOf } from "../people-pages.ts";

const EVERYONE_PAGE = EVERYONE_PATH;

const INSTANT = /^\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}$/;

const SIGN_OUT = PERSON_WORDS.signOutEverywhere;

const ENDED_AT = /\d{2}:\d{2}/;

const aTag = (): string => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const regionOf = (sheet: Locator, name: string): Locator =>
  sheet.getByRole("region", { name, exact: true });

const sessionsOf = (sheet: Locator): Locator => regionOf(sheet, "Sessions").getByRole("listitem");

const confirmationOf = (page: Page): Locator =>
  page.getByRole("dialog", { name: PERSON_WORDS.signOutTitle("Priya Shah") });

const theOperatorsWorkspace = async (api: APIRequestContext, tag: string) => {
  const email = anAddress(`${tag}-operator`);
  const workspace = await provision(api, { name: `Operators ${tag}`, adminEmail: email });
  await markTheOperator(api, email);
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

test.describe("a person's sheet, opened from the Everyone page", () => {
  test("an operator cancels, then signs a person out everywhere", async ({
    page,
    request,
    baseURL,
    passesTheAccessibilityGate,
  }) => {
    const tag = aTag();
    const { operators } = await priyaConnected(page, request, baseURL, tag);
    const sheet = await openPriya(page, tag);
    const signOut = sheet.getByRole("button", { name: SIGN_OUT });
    const grant = regionOf(sheet, PERSON_WORDS.assistantAccess).getByRole("listitem", {
      name: "Claude",
    });
    await expect(grant).toBeVisible();

    await signOut.click();
    const confirmation = confirmationOf(page);
    await expect(confirmation).toHaveAccessibleDescription(/Priya Shah/);
    await passesTheAccessibilityGate();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(signOut).toBeFocused();
    await expect(sessionsOf(sheet)).toHaveCount(1);

    await signOut.click();
    await confirmation.getByRole("button", { name: SIGN_OUT }).focus();
    await clockTheNextKey(page, {
      at: "//section[div[@data-slot='card-header']/h3[normalize-space(.)='Sessions']][not(.//li)]",
      reads: "Sessions",
    });
    await page.keyboard.press("Enter");

    await expect(sessionsOf(sheet)).toHaveCount(0);
    await actionWithinBudget(page, "sign out everywhere");
    await expect(regionOf(sheet, SIGN_OUT).getByRole("status")).toHaveText(ENDED_AT);
    await expect(signOut).toBeFocused();
    const endedEverywhere = `
      - listitem "Claude":
        - heading "Claude" [level=4]
        - term: Workspace
        - definition: ${operators.name}
        - term: Issued
        - definition: /\\d{4}/
        - term: Ended
        - definition: /\\d{4}/
        - term: ${PERSON_WORDS.endedBy}
        - definition: ${operators.admin.name}
        - term: ${PERSON_WORDS.endedIn}
        - definition: /^(?!${operators.name}$).+/
        - button ${JSON.stringify(PERSON_WORDS.moreAbout("Claude"))}
    `;
    await expect(grant).toMatchAriaSnapshot(endedEverywhere);
    await expect(regionOf(sheet, PERSON_WORDS.signIn).getByRole("definition").nth(1)).toHaveText(
      INSTANT,
    );

    await page.reload();
    await personButton(page, "Priya Shah").click();
    await expect(sessionsOf(sheet)).toHaveCount(0);
    await expect(grant).toMatchAriaSnapshot(endedEverywhere);
  });
});
