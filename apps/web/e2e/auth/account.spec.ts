import assert from "node:assert/strict";

import type { Page } from "@playwright/test";

import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { THEME_KEPT_UNDER } from "@/shared/theme/theme-switch.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  contrastBetween,
  keyShown,
  person,
  provision,
  saysARefusal,
  signedInAtHome,
  signedInWithNoWorkspace,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
  tokenColour,
} from "../harness.ts";
import { accountFromTheBand, codesListed, regionOf } from "../second-factor-steps.ts";

const authenticatorPart = (page: Page) => regionOf(page, "Authenticator");

const codesBlock = (page: Page) => regionOf(page, "Save Your Recovery Codes");

const codeField = (page: Page) => page.getByLabel("Authenticator Code");

const setUpButton = (page: Page) =>
  page.getByRole("button", { name: "Set Up an Authenticator", exact: true });

const doneButton = (page: Page) => page.getByRole("button", { name: "Done" });

const savedBox = (page: Page) => page.getByRole("checkbox", { name: "I have saved these codes" });

const removeButton = (page: Page) =>
  authenticatorPart(page).getByRole("button", { name: "Remove", exact: true });

const setupOpened = async (page: Page): Promise<string> => {
  await setUpButton(page).click();
  await expect(page.getByRole("img", { name: "QR code for your authenticator" })).toBeVisible();
  return keyShown(page);
};

const setUpWithItsCode = async (page: Page): Promise<readonly string[]> => {
  const key = await setupOpened(page);
  await codeField(page).fill(authenticatorCodeAt(key, new Date()));
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  return codesListed(page).allInnerTexts();
};

const doneClosesTheCodes = async (page: Page): Promise<void> => {
  await doneButton(page).click();
  await expect(codesBlock(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 3, name: "Recovery Codes", exact: true }),
  ).toBeFocused();
};

const anEditorOnAccount = async (page: Page, api: Parameters<typeof person>[0]) => {
  const email = anAddress("editor");
  const editor = await person(api, email, { displayName: "Ines Editor" });
  const workspace = await provision(api, { name: "Calder Joinery" });
  await addMember(api, { role: "Editor", userId: editor.id, workspaceId: workspace.workspaceId });
  await signedInAtHome(page, api, email, "Editor");
  await accountFromTheBand(page, editor.name);
  await expect(setUpButton(page)).toBeVisible();
};

test("Done waits for the tick, and a reload shows none", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await anEditorOnAccount(page, request);
  await setUpWithItsCode(page);

  await tabUntilFocused(page, doneButton(page));
  await clockTheNextKey(page, {
    at: `//section[h3[normalize-space(.)="Save Your Recovery Codes"]][.//*[@role='alert'][normalize-space(.)]]`,
    reads: "Save Your Recovery Codes",
  });
  await page.keyboard.press("Enter");
  await theActionLandedWithinItsBudget(page, "unticked done");
  await saysARefusal(codesBlock(page).getByRole("alert"));
  await expect(savedBox(page)).toBeFocused();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  await passesTheAccessibilityGate();

  await page.keyboard.press("Space");
  await expect(savedBox(page)).toBeChecked();
  await doneClosesTheCodes(page);

  const everyCodeLeft = new RegExp(
    String.raw`^\D*${String(RECOVERY_CODES_IN_A_SET)}\D+${String(RECOVERY_CODES_IN_A_SET)}\b`,
  );
  const codesLeft = regionOf(page, "Recovery Codes").getByRole("paragraph");
  await expect(codesLeft).toHaveText(everyCodeLeft);

  await page.reload();
  await expect(codesLeft).toHaveText(everyCodeLeft);
  await expect(removeButton(page), "the page does not list the authenticator").toBeVisible();
  await expect(codesListed(page)).toHaveCount(0);
});

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
