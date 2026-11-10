import assert from "node:assert/strict";

import type { Locator } from "@playwright/test";

import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { AUTHENTICATOR_WORDS, RECOVERY_CODE_WORDS } from "@/features/auth/account-words.ts";
import { SETUP_WORDS, USE_CODE } from "@/features/auth/second-factor/second-factor-words.ts";

import { expect, test } from "../browser.ts";
import { pageHidesRefusalWord, landedAtHome, signIn } from "../harness.ts";
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

const READ_BUDGET_MS = 1000;

const codeUsedByKeyboard = async (field: Locator, code: string): Promise<void> => {
  const page = field.page();
  await field.fill(code);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: USE_CODE }),
    "Tab from the field did not reach Use Code",
  ).toBeFocused();
  await page.keyboard.press("Enter");
};

test("replaces recovery codes never confirmed as saved at sign-in", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { email, key } = await anAdminWithAnAuthenticator(page, request, "none");
  await codeField(page).fill(codeOf(key));
  await expect(heading(page, RECOVERY_CODE_WORDS.saveHeading)).toBeVisible();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  await expect(
    recoveryCodesParagraphs(page),
    "the first set says it replaces an earlier set",
  ).toHaveCount(1);
  const first = await codesListed(page).allInnerTexts();

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(heading(page, RECOVERY_CODE_WORDS.saveHeading)).toBeVisible();
  await expect(page).toHaveURL(/\/recovery-codes$/);
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  const second = await codesListed(page).allInnerTexts();
  expect(
    second.filter((code) => first.includes(code)),
    "the new set shares a code with the first set",
  ).toEqual([]);
  await expect(
    recoveryCodesParagraphs(page),
    "the new set does not say it replaces the first",
  ).toHaveCount(2);
  await passesTheAccessibilityGate();
  await codesTicked(page, AUTHENTICATOR_WORDS.finish);
  await landedAtHome(page, "Admin");

  await signedInAgain(page, request, email);
  const started = Date.now();
  await page.goto("/recovery");
  await expect(recoveryField(page)).toBeFocused();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "recovery read", description: `${elapsed} ms` });
  expect(elapsed, "the recovery page took longer than one second to load").toBeLessThan(
    READ_BUDGET_MS,
  );

  const refused = authAnswering(page, "/second-factor/recovery");
  const [replaced] = first;
  assert.ok(replaced !== undefined, "the first set lists no code");
  await codeUsedByKeyboard(recoveryField(page), replaced);
  expect(await refused).toMatchObject({ status: 400, word: "recovery-code-wrong" });
  await expect(theRefusal(page)).toBeVisible();
  await pageHidesRefusalWord(page, "recovery-code-wrong");
  await passesTheAccessibilityGate();
  const [current] = second;
  assert.ok(current !== undefined, "the second set lists no code");
  await codeUsedByKeyboard(recoveryField(page), current);
  await expect(heading(page, SETUP_WORDS.newHeading)).toBeVisible();
});
