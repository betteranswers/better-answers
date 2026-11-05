import assert from "node:assert/strict";

import type { Locator, Page } from "@playwright/test";

import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { expect, test } from "../browser.ts";
import { keyShown, landedAtHome } from "../harness.ts";
import { authAnswering } from "../refused-read.ts";
import {
  anAdminWithAnAuthenticator,
  codeField,
  codeOf,
  codesListed,
  codesTicked,
  heading,
  recoveryField,
  recoveryCodesParagraphs,
  signedInAgain,
  theRefusal,
} from "../second-factor-steps.ts";

const CONFIRM_BY_CODE = "/second-factor/confirm/authenticator";

const setUpAuthenticatorInsteadButton = (page: Page) =>
  page.getByRole("button", { name: "Set Up an Authenticator Instead" });

const submitCode = async (field: Locator, code: string): Promise<void> => {
  await field.fill(code);
  await field.page().getByRole("button", { name: "Use Code" }).click();
};

const useRecoveryCode = async (page: Page, code: string): Promise<void> => {
  await page.goto("/recovery");
  await expect(recoveryField(page)).toBeFocused();
  await submitCode(recoveryField(page), code);
  await expect(heading(page, "Set Up a New Second Factor")).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
};

const setUpAuthenticator = async (page: Page): Promise<string> => {
  await setUpAuthenticatorInsteadButton(page).click();
  const key = await keyShown(page);
  await page.getByLabel("Authenticator Code").fill(codeOf(key));
  await expect(heading(page, "Save Your Recovery Codes")).toBeVisible();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  return key;
};

test("an Admin uses a recovery code to replace their authenticator", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { email, key, codes } = await anAdminWithAnAuthenticator(page, request);
  const [code] = codes;
  assert.ok(code !== undefined, "the seeded Admin has no recovery code");

  await useRecoveryCode(page, code);
  await passesTheAccessibilityGate();
  const newKey = await setUpAuthenticator(page);

  await expect(
    recoveryCodesParagraphs(page),
    "Save Your Recovery Codes lacks the paragraph about replacing old codes",
  ).toHaveCount(2);
  await codesTicked(page, "Finish Setup");
  await landedAtHome(page, "Admin");
  await signedInAgain(page, request, email);
  await page.goto("/confirm");
  const refused = authAnswering(page, CONFIRM_BY_CODE);
  await codeField(page).fill(codeOf(key));
  expect(await refused).toMatchObject({ status: 400, word: "code-wrong" });
  await expect(theRefusal(page)).toBeVisible();
  await codeField(page).fill(codeOf(newKey));
  await landedAtHome(page, "Admin");
});
