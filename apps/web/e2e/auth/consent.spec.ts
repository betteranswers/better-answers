import assert from "node:assert/strict";

import type { APIRequestContext, Page } from "@playwright/test";

import { THEME_KEPT_UNDER } from "@/shared/theme/theme-switch.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  claudesAuthorizeUrl,
  drawnMarks,
  provision,
  endEverySignInAndToken,
  signIn,
  tokenPainted,
} from "../harness.ts";

const READ_BUDGET_MS = 1000;

const consentHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Connect Claude" });

const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset["theme"]);

const pagePainted = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const paintsTheDarkPage = async (page: Page): Promise<string> => {
  expect(await themeOf(page), "the page did not keep the saved theme").toBe("dark");
  const painted = await pagePainted(page);
  expect(painted, "the page background is transparent in dark mode").not.toBe("rgba(0, 0, 0, 0)");
  expect(painted).toBe(await tokenPainted(page, "--surface-page", "background-color"));
  return painted;
};

const anAdminSignedIn = async (page: Page, api: APIRequestContext, who: string) => {
  const email = anAddress(who);
  const workspace = await provision(api, { name: `${who} Ltd`, adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  return workspace;
};

const atConsent = async (page: Page, origin: string): Promise<void> => {
  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();
};

const connectOnceRevoked = async (page: Page, api: APIRequestContext, userId: string) => {
  await endEverySignInAndToken(api, userId);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in again" })).toBeVisible();
};

test("styles the Connect Claude consent page like the sign-in pages", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite no baseURL");
  await anAdminSignedIn(page, request, "drawn");

  const started = Date.now();
  await atConsent(page, baseURL);
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "consent read", description: `${elapsed} ms` });
  expect(elapsed, "the consent page took longer than one second to load").toBeLessThan(
    READ_BUDGET_MS,
  );

  expect(await drawnMarks(page), "the card is not the only marked region").toEqual(["card"]);
  const geistLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [
      document.fonts.check('16px "Geist Variable"'),
      document.fonts.check('16px "Geist Mono Variable"'),
    ];
  });
  expect(geistLoaded, "the API did not serve both Geist fonts").toEqual([true, true]);
  await expect(consentHeading(page)).toHaveCSS("font-family", /^"Geist Variable"/);

  const connect = page.getByRole("button", { name: "Connect" });
  const fill = await tokenPainted(page, "--control-primary-bg", "background-color");
  expect(fill, "the primary button's colour token is transparent").not.toBe("rgba(0, 0, 0, 0)");
  await expect(connect).toHaveCSS("background-color", fill);
  await expect(connect).toHaveCSS("border-radius", "0px");

  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toHaveAttribute("data-variant", "outline");
  await expect(cancel).toHaveCSS("border-top-width", "1px");

  await page.keyboard.press("Tab");
  await expect(connect).toBeFocused();
  const ring = await tokenPainted(page, "--focus-ring", "box-shadow");
  await expect(connect).toHaveCSS("box-shadow", ring);
  await passesTheAccessibilityGate();

  await page.setViewportSize({ width: 320, height: 720 });
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, "the page scrolls sideways at 320px").toBe(0);
});

test("keeps the saved dark theme on the consent pages", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite no baseURL");
  await page.emulateMedia({ colorScheme: "light" });
  const workspace = await anAdminSignedIn(page, request, "keeps-dark");
  await atConsent(page, baseURL);
  expect(await themeOf(page), "a light device opened a dark page").toBe("light");
  const light = await pagePainted(page);

  await page.evaluate((key) => {
    localStorage.setItem(key, "dark");
  }, THEME_KEPT_UNDER);
  await page.reload();

  await expect(consentHeading(page)).toBeVisible();
  expect(
    await paintsTheDarkPage(page),
    "the dark theme paints the page the same as the light theme",
  ).not.toBe(light);
  await expect(page.locator("script[src]"), "the consent page loaded the SPA").toHaveCount(0);
  await passesTheAccessibilityGate();

  await connectOnceRevoked(page, request, workspace.admin.id);
  expect(
    await paintsTheDarkPage(page),
    "the dark theme paints the page the same as the light theme",
  ).not.toBe(light);
});
