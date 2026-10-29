import assert from "node:assert/strict";

import type { Page } from "@playwright/test";

import { THEME_KEPT_UNDER } from "@/shared/theme/theme-switch.ts";

import { expect, test } from "../browser.ts";
import { contrastBetween, signedInWithNoWorkspace, tokenColour } from "../harness.ts";

const keptOnThisBrowser = (page: Page, theme: string) =>
  page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_KEPT_UNDER, theme] as const,
  );

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
