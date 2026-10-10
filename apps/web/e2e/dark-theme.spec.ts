import type { Page } from "@playwright/test";

import {
  ACCOUNT_ACTIONS,
  ACCOUNT_HEADING,
  AUTHENTICATOR_WORDS,
  THEME_WORDS,
} from "@/features/auth/account-words.ts";
import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";
import { THEME_KEPT_UNDER } from "@/shared/theme-switch.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  contrastBetween,
  provision,
  signedInAtHome,
  signedInWithNoWorkspace,
  signInHeading,
  tokenColour,
} from "./harness.ts";

const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset["theme"]);

/** The page's own colour, as `<html>` paints it under the theme in force. */
const pagePainted = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

const keptOnThisBrowser = (page: Page, theme: string) =>
  page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_KEPT_UNDER, theme] as const,
  );

/** What the email step paints on its field and its two ways on. */
const emailStepPaint = (page: Page) =>
  Promise.all(
    [
      page.getByLabel(SIGN_IN_WORDS.emailField),
      page.getByRole("button", { name: SIGN_IN_WORDS.passkey }),
      page.getByRole("button", { name: SIGN_IN_WORDS.send }),
    ].map((part) =>
      part.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.backgroundColor, style.borderColor, style.color].join(" ");
      }),
    ),
  );

test("keeps a kept light page light on a dark device", async ({ page }) => {
  await keptOnThisBrowser(page, "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();
  const underLight = await emailStepPaint(page);

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await themeOf(page)).toBe("light");
  expect(await emailStepPaint(page), "a dark device repainted a page kept light").toEqual(
    underLight,
  );
});

test("picks dark on the Account page and keeps it", async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const email = anAddress("theme");
  await provision(request, { name: "Calder Lighting", adminEmail: email });
  await signedInAtHome(page, request, email);
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_HEADING })).toBeVisible();

  const theme = page.getByRole("radiogroup", { name: THEME_WORDS.heading });
  await expect(theme.getByRole("radio", { name: THEME_WORDS.device })).toBeChecked();
  await theme.getByRole("radio", { name: THEME_WORDS.device }).focus();
  // The group checks the radio it moves to, a task later, only while the arrow is still held.
  for (const next of [THEME_WORDS.light, THEME_WORDS.dark]) {
    await page.keyboard.down("ArrowDown");
    await expect(theme.getByRole("radio", { name: next })).toBeChecked();
    await page.keyboard.up("ArrowDown");
  }
  expect(await themeOf(page), "picking Dark left the page light").toBe("dark");

  await page.reload();
  await expect(
    page
      .getByRole("radiogroup", { name: THEME_WORDS.heading })
      .getByRole("radio", { name: THEME_WORDS.dark }),
  ).toBeChecked();
  expect(await themeOf(page), "a reload lost the theme picked").toBe("dark");
});

test("opens the sign-in page in the theme kept", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await keptOnThisBrowser(page, "dark");
  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();

  expect(await themeOf(page), "the device's light outranked the kept dark").toBe("dark");
  expect(await pagePainted(page)).toBe(await tokenColour(page, "--surface-page"));
});

test("follows the device until a theme is picked", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();
  expect(await themeOf(page), "a dark device opened a light page").toBe("dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(() => themeOf(page), { message: "the page kept the device's old theme" })
    .toBe("light");
});

test("paints the kept theme before the page's scripts run", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await keptOnThisBrowser(page, "dark");
  const darkPage = await test.step("read the dark page colour", async () => {
    await page.goto("/sign-in");
    await expect(signInHeading(page)).toBeVisible();
    await passesTheAccessibilityGate();
    return tokenColour(page, "--surface-page");
  });

  await page.route("**/assets/*.js", (route) => route.abort());
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });

  expect(await themeOf(page), "the head painted no theme without the scripts").toBe("dark");
  expect(await pagePainted(page), "the first paint was not the dark page").toBe(darkPage);
  await page.unroute("**/assets/*.js");
  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();
});

/** `#rrggbb` as a browser paints it, so the suite's contrast reads it. */
const paintedHex = (hex: string): string =>
  `rgb(${[1, 3, 5].map((at) => String(Number.parseInt(hex.slice(at, at + 2), 16))).join(", ")})`;

test("draws the authenticator's code dark on light in dark", async ({ page, request }) => {
  await keptOnThisBrowser(page, "dark");
  await signedInWithNoWorkspace(page, request, "theme-code");
  await page.goto("/account");
  await page.getByRole("button", { name: ACCOUNT_ACTIONS.setUp }).click();
  const code = page.getByRole("img", { name: AUTHENTICATOR_WORDS.qrCode });
  await expect(code).toBeVisible();

  const [modules = "", field = ""] = await Promise.all([
    code.locator("path[stroke]").first().getAttribute("stroke"),
    code.locator("path[fill]").first().getAttribute("fill"),
  ]).then((colours) => colours.map((colour) => paintedHex(colour ?? "")));
  expect(contrastBetween(modules, field), "a scanner cannot read the code").toBeGreaterThanOrEqual(
    4.5,
  );
  expect(modules, "the code is drawn light on dark").toBe(await tokenColour(page, "--grey-900"));
});
