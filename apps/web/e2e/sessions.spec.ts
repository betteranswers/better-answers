import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  aSessionOn,
  anAddress,
  aPkcePair,
  catchClaudesRedirect,
  claudeExchanges,
  claudeRefreshes,
  claudesAuthorizeUrl,
  landedAtHome,
  provision,
  signIn,
  signInHeading,
  signedInWithNoWorkspace,
} from "./harness.ts";

const sessionsRegion = (page: Page) => page.getByRole("region", { name: "Sessions" });

const rowsIn = (page: Page): Locator => sessionsRegion(page).getByRole("listitem");

/** A session row's name: the row says which session of which device it is. */
const rowNamed = (device: string): string => `A session on ${device}`;

const rowOf = (page: Page, device: string) =>
  sessionsRegion(page).getByRole("listitem", { name: rowNamed(device), exact: true });

/** The status an action's outcome is said in: the one holding words. */
const saidIn = (page: Page) => sessionsRegion(page).getByRole("status").filter({ hasText: /\S/ });

const accountOpened = async (page: Page): Promise<void> => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
};

/** A person in no workspace, whose Account page lists only their own sessions. */
const aPersonOnTheAccountPage = async (page: Page, api: APIRequestContext, who: string) => {
  const signedIn = await signedInWithNoWorkspace(page, api, who);
  await accountOpened(page);
  return signedIn;
};

/** `Last active 14:05 · 3 March 2026`, as the row shows a session's last activity. */
const LAST_ACTIVE = /Last active \d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}/;

test("shows the current session first, tagged, without a sign-out", async ({ page, request }) => {
  await aPersonOnTheAccountPage(page, request, "current");

  const rows = rowsIn(page);
  await expect(rows).toHaveCount(1);
  const current = rows.first();
  await expect(current).toContainText("This device");
  await expect(current).toContainText("Active now");
  await expect(current.getByRole("button", { name: /Sign out/ })).toHaveCount(0);
  await expect(
    sessionsRegion(page).getByRole("button", { name: "Sign Out Everywhere Else" }),
    "the current session is the only one",
  ).toHaveCount(0);
  await expect(sessionsRegion(page)).toContainText("This is your only session.");
});

test("carries no address in the sessions it answers", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "no-address");
  const read = page.waitForResponse((answer) => answer.url().includes("person.sessions"));
  await accountOpened(page);

  const body = await (await read).text();

  expect(body).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  expect(body).not.toMatch(/ip/i);
});

test("an unreadable agent reads as an unknown device", async ({ page, request }) => {
  const person = await aPersonOnTheAccountPage(page, request, "unreadable");
  await aSessionOn(request, person.id, "Something/1.0");

  await page.reload();
  const row = rowOf(page, "Unknown device");
  await expect(row).toBeVisible();
  await expect(row).toContainText(LAST_ACTIVE);
});

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
  const origin = baseURL ?? "";
  const email = anAddress("everywhere");
  const { admin } = await provision(request, { name: "Everywhere Ltd", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");
  const { verifier, challenge } = aPkcePair();
  await catchClaudesRedirect(page);
  await page.goto(claudesAuthorizeUrl(origin, { challenge, prompt: "consent" }));
  await page.getByRole("button", { name: "Connect" }).click();
  const code = new URL(page.url()).searchParams.get("code") ?? "";
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
