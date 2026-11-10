import type { APIRequestContext, Page } from "@playwright/test";

import { AUTHENTICATOR_WORDS, PASSKEY_WORDS } from "@/features/auth/account-words.ts";
import { SETUP_WORDS } from "@/features/auth/second-factor/second-factor-words.ts";

import { expect, test } from "../browser.ts";
import { provision, signInByEmail, tabUntilFocused } from "../harness.ts";

const READ_BUDGET_MS = 1000;

const codeField = (page: Page) => page.getByLabel(AUTHENTICATOR_WORDS.codeField);

const passkeyName = (page: Page) => page.getByLabel(PASSKEY_WORDS.nameField);

const authenticatorInstead = (page: Page) =>
  page.getByRole("button", { name: SETUP_WORDS.authenticatorInstead });

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
  await expect(primaries(page)).toHaveText([SETUP_WORDS.addPasskey]);

  await tabUntilFocused(page, authenticatorInstead(page));
  await page.keyboard.press("Enter");

  await expect(codeField(page)).toBeVisible();
  await expect(primaries(page)).toHaveText([AUTHENTICATOR_WORDS.finish]);
  await expect(passkeyName(page)).toBeHidden();
  await expect(authenticatorInstead(page)).toBeFocused();
  await passesTheAccessibilityGate();

  await page.keyboard.press("Enter");

  await expect(passkeyName(page)).toBeVisible();
  await expect(primaries(page)).toHaveText([SETUP_WORDS.addPasskey]);
  await expect(authenticatorInstead(page)).toBeFocused();
});
