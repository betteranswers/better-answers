import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  aPkcePair,
  aSessionOn,
  catchClaudesRedirect,
  claudeExchanges,
  claudeRefreshes,
  claudesAuthorizeUrl,
  landedAtHome,
  provision,
  signedInWithNoWorkspace,
  signIn,
  signInHeading,
} from "../harness.ts";

const sessionsRegion = (page: Page) => page.getByRole("region", { name: "Sessions" });

const rowsIn = (page: Page): Locator => sessionsRegion(page).getByRole("listitem");

const rowNamed = (device: string): string => `A session on ${device}`;

const rowOf = (page: Page, device: string) =>
  sessionsRegion(page).getByRole("listitem", { name: rowNamed(device), exact: true });

const saidIn = (page: Page) => sessionsRegion(page).getByRole("status").filter({ hasText: /\S/ });

const accountOpened = async (page: Page): Promise<void> => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
};

const aPersonOnTheAccountPage = async (page: Page, api: APIRequestContext, who: string) => {
  const signedIn = await signedInWithNoWorkspace(page, api, who);
  await accountOpened(page);
  return signedIn;
};

test("a sign-out removes its row and focuses the next", async ({ page, request }) => {
  const person = await aPersonOnTheAccountPage(page, request, "removes");
  const safari = await aSessionOn(
    request,
    person.id,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
  const edge = await aSessionOn(
    request,
    person.id,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  );

  await page.reload();
  await expect(rowsIn(page)).toHaveCount(3);
  await rowOf(page, "Edge on Windows")
    .getByRole("button", { name: "Sign out Edge on Windows" })
    .click();

  await expect(rowOf(page, "Edge on Windows")).toHaveCount(0);
  await expect(saidIn(page)).toHaveText("Signed out Edge on Windows.");
  await expect(
    rowOf(page, "Safari on iOS").getByRole("button", { name: "Sign out Safari on iOS" }),
  ).toBeFocused();

  await rowOf(page, "Safari on iOS")
    .getByRole("button", { name: "Sign out Safari on iOS" })
    .click();

  await expect(rowsIn(page)).toHaveCount(1);
  await expect(saidIn(page)).toHaveText("Signed out Safari on iOS.");
  await expect(sessionsRegion(page).getByRole("heading", { name: "Sessions" })).toBeFocused();
  expect(safari).not.toBe("");
  expect(edge).not.toBe("");
});

test("a refused sign-out puts the row back with an alert", async ({ page, browser, request }) => {
  const person = await aPersonOnTheAccountPage(page, request, "refused");
  await aSessionOn(
    request,
    person.id,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
  await page.reload();
  const row = rowOf(page, "Safari on iOS");
  await expect(row).toBeVisible();

  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.goto("/sign-in");
  await signIn(other, request, person.email);
  await accountOpened(other);

  await rowOf(other, "Safari on iOS")
    .getByRole("button", { name: "Sign out Safari on iOS" })
    .click();
  await expect(rowOf(other, "Safari on iOS")).toHaveCount(0);

  await row.getByRole("button", { name: "Sign out Safari on iOS" }).click();

  await expect(row, "a session already gone returns to the list").toBeVisible();
  await expect(sessionsRegion(page).getByRole("alert")).toHaveText(
    "This session has already ended.",
  );
  await expect(
    row.getByRole("button", { name: "Sign out Safari on iOS" }),
    "focus returns to the row the alert stands beside",
  ).toBeFocused();
  await elsewhere.close();
});

test("everywhere else asks first and keeps a personal token working", async ({
  page,
  request,
  baseURL,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const origin = baseURL;
  const email = anAddress("everywhere");
  const { admin } = await provision(request, { name: "Everywhere Ltd", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");
  const { verifier, challenge } = aPkcePair();
  await catchClaudesRedirect(page);
  await page.goto(claudesAuthorizeUrl(origin, { challenge, prompt: "consent" }));
  await page.getByRole("button", { name: "Connect" }).click();
  const code = new URL(page.url()).searchParams.get("code");
  assert.ok(code !== null, "Claude's redirect carries a code");
  const { refreshToken } = await claudeExchanges(request, { origin, code, verifier });
  await aSessionOn(
    request,
    admin.id,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );

  await accountOpened(page);
  await expect(rowsIn(page)).toHaveCount(2);
  await sessionsRegion(page).getByRole("button", { name: "Sign Out Everywhere Else" }).click();

  const dialog = page.getByRole("dialog", { name: "Sign out of 1 other session" });
  await expect(dialog).toContainText(
    "Each one ends now. Personal tokens keep working, and Claude stays connected.",
  );
  await dialog.getByRole("button", { name: "Sign out 1 session" }).click();

  await expect(rowsIn(page)).toHaveCount(1);
  await expect(saidIn(page)).toHaveText("Signed out 1 session.");
  await expect(sessionsRegion(page).getByRole("heading", { name: "Sessions" })).toBeFocused();
  await expect(signInHeading(page)).not.toBeVisible();

  const refreshed = await claudeRefreshes(request, { origin, refreshToken });

  expect(refreshed.refreshToken).not.toBe("");
});
