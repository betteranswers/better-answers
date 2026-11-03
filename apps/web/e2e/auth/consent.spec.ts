import assert from "node:assert/strict";

import type { APIRequestContext, Page } from "@playwright/test";

import { THEME_KEPT_UNDER } from "@/shared/theme/theme-switch.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  catchClaudesRedirect,
  CLAUDES_REDIRECT_URI,
  claudesAuthorizeUrl,
  drawnMarks,
  provision,
  endEverySignInAndToken,
  signIn,
  tokenPainted,
} from "../harness.ts";

const landedAt = (page: Page): URL => new URL(page.url());

const consentHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Connect Claude" });

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Your Name" });

const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset["theme"]);

const pagePainted = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const paintsTheDarkPage = async (page: Page): Promise<string> => {
  expect(await themeOf(page), "the page ignored the theme kept").toBe("dark");
  const painted = await pagePainted(page);
  expect(painted, "the page's token resolves in dark").not.toBe("rgba(0, 0, 0, 0)");
  expect(painted).toBe(await tokenPainted(page, "--surface-page", "background-color"));
  return painted;
};

const anAdminAtConsent = async (
  page: Page,
  api: APIRequestContext,
  origin: string,
  who: string,
) => {
  const email = anAddress(who);
  const workspace = await provision(api, { name: `${who} Ltd`, adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();
  return workspace;
};

const connectOnceRevoked = async (page: Page, api: APIRequestContext, userId: string) => {
  await endEverySignInAndToken(api, userId);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in again" })).toBeVisible();
};

const connectedAt = async (page: Page): Promise<URL> => {
  await page.getByRole("button", { name: "Connect" }).click();
  const callback = landedAt(page);
  expect(`${callback.origin}${callback.pathname}`).toBe(CLAUDES_REDIRECT_URI);
  expect(callback.searchParams.get("code")).not.toBeNull();
  return callback;
};

test("draws consent in the sign-in pages' card, faces and tokens", async ({
  page,
  request,
  baseURL,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  await anAdminAtConsent(page, request, baseURL, "drawn");

  expect(await drawnMarks(page), "the card stands for its primary button").toEqual(["card"]);
  const geistLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [
      document.fonts.check('16px "Geist Variable"'),
      document.fonts.check('16px "Geist Mono Variable"'),
    ];
  });
  expect(geistLoaded, "the api serves both faces").toEqual([true, true]);
  await expect(consentHeading(page)).toHaveCSS("font-family", /^"Geist Variable"/);

  const connect = page.getByRole("button", { name: "Connect" });
  const fill = await tokenPainted(page, "--control-primary-bg", "background-color");
  expect(fill, "the primary's token resolves").not.toBe("rgba(0, 0, 0, 0)");
  await expect(connect).toHaveCSS("background-color", fill);
  await expect(connect).toHaveCSS("border-radius", "0px");

  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toHaveAttribute("data-variant", "outline");
  await expect(cancel).toHaveCSS("border-top-width", "1px");

  await page.keyboard.press("Tab");
  await expect(connect).toBeFocused();
  const ring = await tokenPainted(page, "--focus-ring", "box-shadow");
  await expect(connect).toHaveCSS("box-shadow", ring);

  await page.setViewportSize({ width: 320, height: 720 });
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, "the page scrolls sideways at 320px").toBe(0);
});

test("draws consent, then its refusal, in the dark theme kept", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  await page.emulateMedia({ colorScheme: "light" });
  const workspace = await anAdminAtConsent(page, request, baseURL, "keeps-dark");
  expect(await themeOf(page), "a light device opened a dark page").toBe("light");
  const light = await pagePainted(page);

  await page.evaluate((key) => {
    localStorage.setItem(key, "dark");
  }, THEME_KEPT_UNDER);
  await page.reload();

  await expect(consentHeading(page)).toBeVisible();
  expect(await paintsTheDarkPage(page), "dark painted the light page").not.toBe(light);
  await expect(page.locator("script[src]"), "the consent page loaded the SPA").toHaveCount(0);
  await passesTheAccessibilityGate();

  await connectOnceRevoked(page, request, workspace.admin.id);
  expect(await paintsTheDarkPage(page), "dark painted the light page").not.toBe(light);
});

test("asks consent again only when the host asks for it", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const origin = baseURL;
  const email = anAddress("returning");
  await provision(request, { name: "Returning Ltd", adminEmail: email });
  await catchClaudesRedirect(page);
  await page.goto("/sign-in");
  await signIn(page, request, email);

  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent", state: "first" }));
  await expect(consentHeading(page)).toBeVisible();
  await passesTheAccessibilityGate();
  await page.getByRole("button", { name: "Connect" }).click();
  expect(landedAt(page).searchParams.get("state")).toBe("first");

  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent", state: "second" }));
  await expect(consentHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/consent");
  await page.getByRole("button", { name: "Connect" }).click();
  expect(landedAt(page).searchParams.get("state")).toBe("second");
  expect(landedAt(page).searchParams.get("code")).not.toBeNull();

  await page.goto(claudesAuthorizeUrl(origin, { state: "third" }));
  const skipped = landedAt(page);
  expect(`${skipped.origin}${skipped.pathname}`).toBe(CLAUDES_REDIRECT_URI);
  expect(skipped.searchParams.get("state")).toBe("third");
  expect(skipped.searchParams.get("code")).not.toBeNull();
  await expect(consentHeading(page)).toHaveCount(0);
});

test("takes a named member from connector sign-in straight to consent", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const email = anAddress("named-connecting");
  await provision(request, { name: "Named Connecting Ltd", adminEmail: email });
  await catchClaudesRedirect(page);

  await page.goto(claudesAuthorizeUrl(baseURL, { prompt: "consent" }));
  await signIn(page, request, email);

  await expect(consentHeading(page)).toBeVisible();
  await expect(displayNameHeading(page)).toHaveCount(0);
  await passesTheAccessibilityGate();
  await connectedAt(page);
});
