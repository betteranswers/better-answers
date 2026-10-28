import assert from "node:assert/strict";

import type { Locator, Page } from "@playwright/test";

import { THEME_KEPT_UNDER } from "@/shared/theme/theme-switch.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  contrastBetween,
  provision,
  signedInAtHome,
  signedInWithNoWorkspace,
  signInHeading,
  tokenColour,
} from "../harness.ts";

const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset["theme"]);

const pagePainted = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

const keptOnThisBrowser = (page: Page, theme: string) =>
  page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_KEPT_UNDER, theme] as const,
  );

const emailStepPaint = (page: Page) =>
  Promise.all(
    [
      page.getByLabel("Email Address"),
      page.getByRole("button", { name: "Sign In with a Passkey" }),
      page.getByRole("button", { name: "Send Code" }),
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
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();

  const theme = page.getByRole("radiogroup", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "Match this device" })).toBeChecked();
  await theme.getByRole("radio", { name: "Match this device" }).focus();
  // The group checks the radio it moves to, a task later, only while the arrow is still held.
  for (const next of ["Light", "Dark"]) {
    await page.keyboard.down("ArrowDown");
    await expect(theme.getByRole("radio", { name: next })).toBeChecked();
    await page.keyboard.up("ArrowDown");
  }
  expect(await themeOf(page), "picking Dark left the page light").toBe("dark");

  await page.reload();
  await expect(
    page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" }),
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

const paintedHex = (hex: string): string =>
  `rgb(${[1, 3, 5].map((at) => String(Number.parseInt(hex.slice(at, at + 2), 16))).join(", ")})`;

test("draws the authenticator's code dark on light in dark", async ({ page, request }) => {
  await keptOnThisBrowser(page, "dark");
  await signedInWithNoWorkspace(page, request, "theme-code");
  await page.goto("/account");
  await page.getByRole("button", { name: "Set Up an Authenticator" }).click();
  const code = page.getByRole("img", { name: "QR code for your authenticator" });
  await expect(code).toBeVisible();

  const [stroke, fill] = await Promise.all([
    code.locator("path[stroke]").first().getAttribute("stroke"),
    code.locator("path[fill]").first().getAttribute("fill"),
  ]);
  assert.ok(stroke !== null, "the code's modules name no stroke");
  assert.ok(fill !== null, "the code's field names no fill");
  const modules = paintedHex(stroke);
  const field = paintedHex(fill);
  expect(contrastBetween(modules, field), "a scanner cannot read the code").toBeGreaterThanOrEqual(
    4.5,
  );
  expect(modules, "the code is drawn light on dark").toBe(await tokenColour(page, "--grey-900"));
});

/** A control's words and fill as painted, read through a canvas, which takes the `oklab()` a `/90` fill computes to. */
const wordsAndFill = (control: Locator) =>
  control.evaluate((node) => {
    const pixel = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    if (pixel === null) throw new Error("the page has no canvas to read a colour with");
    const paint = (colours: readonly string[]) => {
      pixel.clearRect(0, 0, 1, 1);
      for (const colour of colours) {
        pixel.fillStyle = colour;
        pixel.fillRect(0, 0, 1, 1);
      }
      const [red = 0, green = 0, blue = 0] = pixel.getImageData(0, 0, 1, 1).data;
      return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
    };
    const page = getComputedStyle(document.documentElement).backgroundColor;
    const style = getComputedStyle(node);
    return { words: paint([style.color]), fill: paint([page, style.backgroundColor]) };
  });

test("keeps the hovered primary's words at 4.5:1 in dark", async ({ page }) => {
  await keptOnThisBrowser(page, "dark");
  await page.goto("/sign-in");
  const send = page.getByRole("button", { name: "Send Code" });
  await expect(send).toBeVisible();

  await send.hover();
  await send.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map(async (animation) => animation.finished));
  });
  const { words, fill } = await wordsAndFill(send);
  expect(contrastBetween(words, fill), `${words} on ${fill}`).toBeGreaterThanOrEqual(4.5);
});
