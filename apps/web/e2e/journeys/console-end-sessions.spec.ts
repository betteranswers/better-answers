import type { APIRequestContext, Locator, Page } from "@playwright/test";

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
  markTheOperator,
  person,
  provision,
  signedInAtHome,
  signIn,
  theActionLandedWithinItsBudget,
} from "../harness.ts";

const EVERYONE_PAGE = pageNamed(menuGroupIn(CONSOLE, "people"), "Everyone").path;

const INSTANT = /^\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}$/;

const REVOKE = "End Every Sign-In and Token";

const ENDED_AT = /\d{2}:\d{2}/;

const aTag = (): string => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const everyone = (page: Page) => page.getByRole("region", { name: "Everyone" });

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
