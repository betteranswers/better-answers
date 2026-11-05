import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import { provision, signInByEmail, tabUntilFocused } from "../harness.ts";

const READ_BUDGET_MS = 1000;

const codeField = (page: Page) => page.getByLabel("Authenticator Code");

const passkeyName = (page: Page) => page.getByLabel("Passkey Name");

const authenticatorInstead = (page: Page) =>
  page.getByRole("button", { name: "Set Up an Authenticator Instead" });

const primaries = (page: Page) =>
  page.getByRole("button").and(page.locator('[data-variant="default"]'));

const anAdminOnSetup = async (page: Page, api: APIRequestContext): Promise<void> => {
  const { admin } = await provision(api, { name: "Skipton Setups" });
  await page.goto("/sign-in");
  await signInByEmail(page, api, admin.email);
  await expect(passkeyName(page)).toBeVisible();
};

test("setup shows one primary button for passkey or authenticator", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await anAdminOnSetup(page, request);

  const started = Date.now();
  await page.goto("/setup");
  await expect(passkeyName(page)).toBeVisible();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "setup read", description: `${elapsed} ms` });
  expect(elapsed, "the setup page took longer than one second to load").toBeLessThan(
    READ_BUDGET_MS,
  );
  await expect(primaries(page)).toHaveText(["Add a Passkey"]);

  await tabUntilFocused(page, authenticatorInstead(page));
  await page.keyboard.press("Enter");

  await expect(codeField(page)).toBeVisible();
  await expect(primaries(page)).toHaveText(["Finish Setup"]);
  await expect(passkeyName(page)).toBeHidden();
  await expect(authenticatorInstead(page)).toBeFocused();
  await passesTheAccessibilityGate();

  await page.keyboard.press("Enter");

  await expect(passkeyName(page)).toBeVisible();
  await expect(primaries(page)).toHaveText(["Add a Passkey"]);
  await expect(authenticatorInstead(page)).toBeFocused();
});
