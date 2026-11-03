import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  AUTHENTICATOR_CODE_LENGTH,
  RECOVERY_CODES_IN_A_SET,
} from "@better-answers/schema/second-factor";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { expect, test } from "../browser.ts";
import {
  enrolledWith,
  keepsItsWordOffThePage,
  keyShown,
  landedAtHome,
  provision,
  saysSomethingNew,
  saysTheWait,
  signIn,
  signInByEmail,
} from "../harness.ts";
import { authAnswering } from "../refused-read.ts";
import { aVirtualAuthenticator } from "../virtual-authenticator.ts";

const CONFIRM_BY_CODE = "/second-factor/confirm/authenticator";

const TOO_MANY_REQUESTS = 429;

const MOST_TRIES = 10;

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

const CONFIRM_HEADING = "Confirm It’s You";

const passkeyButton = (page: Page) =>
  page.getByRole("button", { name: "Use Your Passkey", exact: true });

const codeField = (page: Page) => page.getByRole("textbox", { name: "Authenticator Code" });

const recoveryField = (page: Page) => page.getByRole("textbox", { name: "Recovery Code" });

const addAPasskey = (page: Page) => page.getByRole("button", { name: "Add a Passkey" });

const authenticatorInstead = (page: Page) =>
  page.getByRole("button", { name: "Set Up an Authenticator Instead" });

const codesListed = (page: Page) =>
  page.getByRole("list", { name: "Recovery Codes" }).getByRole("listitem");

const saidOfTheSet = (page: Page) =>
  page.getByRole("region", { name: "Save Your Recovery Codes" }).getByRole("paragraph");

const theRefusal = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

const codeOf = (key: string): string => authenticatorCodeAt(key, new Date());

const aWrongCode = (right: string, nth = 1): string =>
  String((Number(right) + nth) % 10 ** AUTHENTICATOR_CODE_LENGTH).padStart(
    AUTHENTICATOR_CODE_LENGTH,
    "0",
  );

const signedInWaiting = async (page: Page, api: APIRequestContext, email: string, on: string) => {
  await page.goto("/sign-in");
  await signInByEmail(page, api, email);
  await expect(heading(page, on)).toBeVisible();
};

const signedInAgain = async (page: Page, api: APIRequestContext, email: string) => {
  await page.context().clearCookies();
  await signedInWaiting(page, api, email, CONFIRM_HEADING);
};

const anAdminWithAnAuthenticator = async (
  page: Page,
  api: APIRequestContext,
  codes: "saved" | "none" = "saved",
) => {
  const { admin } = await provision(api, { name: "Calder Confirmations" });
  const { key, recoveryCodes } = await enrolledWith(api, admin.email, codes);
  await signedInWaiting(page, api, admin.email, CONFIRM_HEADING);
  return { email: admin.email, key, codes: recoveryCodes };
};

const confirmedByCode = async (page: Page, key: string): Promise<void> => {
  await codeField(page).fill(codeOf(key));
  await landedAtHome(page, "Admin");
};

const codesTicked = async (page: Page, finish: string): Promise<void> => {
  await page.getByRole("checkbox", { name: "I have saved these codes" }).check();
  await page.getByRole("button", { name: finish }).click();
  await expect(codesListed(page)).toHaveCount(0);
};

const anAdminWithBothFactors = async (page: Page, api: APIRequestContext) => {
  const device = await aVirtualAuthenticator(page);
  const admin = await anAdminWithAnAuthenticator(page, api);
  await confirmedByCode(page, admin.key);
  await page.goto("/account");
  await addAPasskey(page).click();
  await page.getByLabel("Passkey Name").fill("Work laptop");
  await page.getByRole("button", { name: "Add Passkey" }).click();
  await expect(page.getByRole("listitem", { name: "Work laptop", exact: true })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: /\S/ })).toBeVisible();

  await device.leftUnattended();
  await signedInAgain(page, api, admin.email);
  await device.attendedAgain();
  return admin;
};

const codeUsed = async (field: Locator, code: string): Promise<void> => {
  await field.fill(code);
  await field.page().getByRole("button", { name: "Use Code" }).click();
};

const recoveryCodeSpent = async (page: Page, code: string): Promise<void> => {
  await page.goto("/recovery");
  await expect(recoveryField(page)).toBeFocused();
  await codeUsed(recoveryField(page), code);
  await expect(heading(page, "Set Up a New Second Factor")).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
};

const authenticatorSetUpThere = async (page: Page): Promise<string> => {
  await authenticatorInstead(page).click();
  const key = await keyShown(page);
  await page.getByLabel("Authenticator Code").fill(codeOf(key));
  await expect(heading(page, "Save Your Recovery Codes")).toBeVisible();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  return key;
};

const wrongCodesUntilTheWait = async (page: Page, key: string) => {
  let saidOfAWrongCode = "";
  for (let tried = 1; tried <= MOST_TRIES; tried += 1) {
    const answered = authAnswering(page, CONFIRM_BY_CODE);
    await codeField(page).fill(aWrongCode(codeOf(key), tried));
    const { status, waitSeconds } = await answered;
    if (status === TOO_MANY_REQUESTS) return { waitSeconds, saidOfAWrongCode };
    saidOfAWrongCode = await theRefusal(page).innerText();
  }
  throw new Error(`${String(MOST_TRIES)} wrong codes, and the field never had to wait`);
};

test("repeated wrong codes make the field wait; passkeys still confirm", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { key } = await anAdminWithBothFactors(page, request);
  await page.goto("/confirm");

  const { waitSeconds, saidOfAWrongCode } = await wrongCodesUntilTheWait(page, key);

  await saysTheWait(theRefusal(page), waitSeconds);
  await saysSomethingNew(theRefusal(page), saidOfAWrongCode);
  await expect(codeField(page)).not.toBeEditable();
  await passesTheAccessibilityGate();
  await passkeyButton(page).click();
  await landedAtHome(page, "Admin");
});

test("a recovery code's setup swaps in a new authenticator", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { email, key, codes } = await anAdminWithAnAuthenticator(page, request);
  const [code] = codes;
  assert.ok(code !== undefined, "the admin holds a recovery code");

  await recoveryCodeSpent(page, code);
  await passesTheAccessibilityGate();
  const newKey = await authenticatorSetUpThere(page);

  await expect(saidOfTheSet(page), "the set does not say it replaces one").toHaveCount(2);
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
  await page.goto("/recovery");
  const refused = authAnswering(page, "/second-factor/recovery");
  const [replaced] = first;
  assert.ok(replaced !== undefined, "the first set listed a code");
  await codeUsed(recoveryField(page), replaced);
  expect(await refused).toMatchObject({ status: 400, word: "recovery-code-wrong" });
  await expect(theRefusal(page)).toBeVisible();
  await keepsItsWordOffThePage(page, "recovery-code-wrong");
  await passesTheAccessibilityGate();
  const [current] = second;
  assert.ok(current !== undefined, "the second set listed a code");
  await codeUsed(recoveryField(page), current);
  await expect(heading(page, "Set Up a New Second Factor")).toBeVisible();
});
