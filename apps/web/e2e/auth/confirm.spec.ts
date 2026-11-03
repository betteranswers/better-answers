import type { APIRequestContext, Page } from "@playwright/test";

import { AUTHENTICATOR_CODE_LENGTH } from "@better-answers/schema/second-factor";

import { expect, test } from "../browser.ts";
import { landedAtHome, saysSomethingNew, saysTheWait } from "../harness.ts";
import { authAnswering } from "../refused-read.ts";
import { aVirtualAuthenticator } from "../virtual-authenticator.ts";
import {
  anAdminWithAnAuthenticator,
  codeField,
  codeOf,
  signedInAgain,
  theRefusal,
} from "./second-factor-steps.ts";

const CONFIRM_BY_CODE = "/second-factor/confirm/authenticator";

const TOO_MANY_REQUESTS = 429;

const MOST_TRIES = 10;

const READ_BUDGET_MS = 1000;

const passkeyButton = (page: Page) =>
  page.getByRole("button", { name: "Use Your Passkey", exact: true });

const addAPasskey = (page: Page) => page.getByRole("button", { name: "Add a Passkey" });

const aWrongCode = (right: string, nth = 1): string =>
  String((Number(right) + nth) % 10 ** AUTHENTICATOR_CODE_LENGTH).padStart(
    AUTHENTICATOR_CODE_LENGTH,
    "0",
  );

const confirmedByCode = async (page: Page, key: string): Promise<void> => {
  await codeField(page).fill(codeOf(key));
  await landedAtHome(page, "Admin");
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

  const started = Date.now();
  await page.goto("/confirm");
  await expect(passkeyButton(page)).toBeFocused();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "confirm read", description: `${elapsed} ms` });
  expect(elapsed, "the confirm page was not read within its second").toBeLessThan(READ_BUDGET_MS);

  await page.keyboard.press("Tab");
  await expect(codeField(page), "Tab left the passkey without reaching the code").toBeFocused();

  const { waitSeconds, saidOfAWrongCode } = await wrongCodesUntilTheWait(page, key);

  await saysTheWait(theRefusal(page), waitSeconds);
  await saysSomethingNew(theRefusal(page), saidOfAWrongCode);
  await expect(codeField(page)).not.toBeEditable();
  await passesTheAccessibilityGate();

  await page.keyboard.press("Shift+Tab");
  await expect(
    passkeyButton(page),
    "Shift+Tab left the code without reaching the passkey",
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await landedAtHome(page, "Admin");
});
