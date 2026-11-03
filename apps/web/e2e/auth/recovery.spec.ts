import assert from "node:assert/strict";

import type { Locator } from "@playwright/test";

import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";

import { expect, test } from "../browser.ts";
import { keepsItsWordOffThePage, landedAtHome, signIn } from "../harness.ts";
import { authAnswering } from "../refused-read.ts";
import {
  anAdminWithAnAuthenticator,
  codeField,
  codeOf,
  codesListed,
  codesTicked,
  heading,
  recoveryField,
  saidOfTheSet,
  signedInAgain,
  theRefusal,
} from "../second-factor-steps.ts";

const READ_BUDGET_MS = 1000;

const codeUsedByKeyboard = async (field: Locator, code: string): Promise<void> => {
  const page = field.page();
  await field.fill(code);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Use Code" }),
    "Tab left the field without reaching Use Code",
  ).toBeFocused();
  await page.keyboard.press("Enter");
};

test("unticked codes come back as a new set at sign-in", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { email, key } = await anAdminWithAnAuthenticator(page, request, "none");
  await codeField(page).fill(codeOf(key));
  await expect(heading(page, "Save Your Recovery Codes")).toBeVisible();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  await expect(saidOfTheSet(page), "a first set says it replaces one").toHaveCount(1);
  const first = await codesListed(page).allInnerTexts();

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(heading(page, "Save Your Recovery Codes")).toBeVisible();
  await expect(page).toHaveURL(/\/recovery-codes$/);
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  const second = await codesListed(page).allInnerTexts();
  expect(
    second.filter((code) => first.includes(code)),
    "a code of the first set came back",
  ).toEqual([]);
  await expect(saidOfTheSet(page), "the set does not say it replaces one").toHaveCount(2);
  await passesTheAccessibilityGate();
  await codesTicked(page, "Finish Setup");
  await landedAtHome(page, "Admin");

  await signedInAgain(page, request, email);
  const started = Date.now();
  await page.goto("/recovery");
  await expect(recoveryField(page)).toBeFocused();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "recovery read", description: `${elapsed} ms` });
  expect(elapsed, "the recovery page was not read within its second").toBeLessThan(READ_BUDGET_MS);

  const refused = authAnswering(page, "/second-factor/recovery");
  const [replaced] = first;
  assert.ok(replaced !== undefined, "the first set listed a code");
  await codeUsedByKeyboard(recoveryField(page), replaced);
  expect(await refused).toMatchObject({ status: 400, word: "recovery-code-wrong" });
  await expect(theRefusal(page)).toBeVisible();
  await keepsItsWordOffThePage(page, "recovery-code-wrong");
  await passesTheAccessibilityGate();
  const [current] = second;
  assert.ok(current !== undefined, "the second set listed a code");
  await codeUsedByKeyboard(recoveryField(page), current);
  await expect(heading(page, "Set Up a New Second Factor")).toBeVisible();
});
