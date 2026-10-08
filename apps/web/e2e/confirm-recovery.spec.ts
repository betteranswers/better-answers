import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  AUTHENTICATOR_CODE_LENGTH,
  RECOVERY_CODES_IN_A_SET,
} from "@better-answers/schema/second-factor";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import {
  ACTION_LANDED,
  AUTHENTICATOR_WORDS,
  PASSKEY_WORDS,
  RECOVERY_CODE_WORDS,
} from "@/features/auth/account-words.ts";
import {
  AUTHENTICATOR_CODE_WRONG,
  RESTORE_CODE_WRONG,
  SAID_OF_SECOND_FACTOR,
  tooManyCodesTriedOr,
} from "@/features/auth/refusal-words.ts";
import {
  CONFIRM_WORDS,
  RECOVERY_WORDS,
  SETUP_WORDS,
  USE_CODE,
} from "@/features/auth/second-factor-words.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  keyShown,
  landedAtHome,
  provision,
  quoted,
  refusedDigitsSelected,
  restored,
  saysItsSentenceNotItsWord,
  signIn,
  signInByEmail,
  enrolledWith,
} from "./harness.ts";
import { aVirtualAuthenticator, withoutWebAuthn } from "./virtual-authenticator.ts";

const CONFIRM_BY_CODE = "**/second-factor/confirm/authenticator";

const TOO_MANY_REQUESTS = 429;

/** The route's own ceiling; the throttle's wait comes well before it. */
const MOST_TRIES = 10;

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

const passkeyButton = (page: Page) => page.getByRole("button", { name: CONFIRM_WORDS.passkey });

const codeField = (page: Page) => page.getByRole("textbox", { name: CONFIRM_WORDS.codeField });

const recoveryField = (page: Page) => page.getByRole("textbox", { name: RECOVERY_WORDS.field });

const restoreField = (page: Page) => page.getByRole("textbox", { name: SETUP_WORDS.restoreField });

const addAPasskey = (page: Page) => page.getByRole("button", { name: SETUP_WORDS.addPasskey });

const authenticatorInstead = (page: Page) =>
  page.getByRole("button", { name: SETUP_WORDS.authenticatorInstead });

const codesListed = (page: Page) =>
  page.getByRole("list", { name: RECOVERY_CODE_WORDS.list }).getByRole("listitem");

/** Every refusal region stands from the first draw, so the one saying something is the refusal. */
const theRefusal = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

const codeOf = (key: string): string => authenticatorCodeAt(key, new Date());

/** Never the code shown now, nor one refused before, which the field would not send again. */
const aWrongCode = (right: string, nth = 1): string =>
  String((Number(right) + nth) % 10 ** AUTHENTICATOR_CODE_LENGTH).padStart(
    AUTHENTICATOR_CODE_LENGTH,
    "0",
  );

/** By email alone, so the sign-in waits on the page that confirms or sets up its second factor. */
const signedInWaiting = async (page: Page, api: APIRequestContext, email: string, on: string) => {
  await page.goto("/sign-in");
  await signInByEmail(page, api, email);
  await expect(heading(page, on)).toBeVisible();
};

/** Drops the cookie alone, so the session it named stays open on the server. */
const signedInAgain = async (page: Page, api: APIRequestContext, email: string) => {
  await page.context().clearCookies();
  await signedInWaiting(page, api, email, CONFIRM_WORDS.heading);
};

/** Left on the confirm page, not yet confirmed, holding ten saved codes unless told none. */
const anAdminWithAnAuthenticator = async (
  page: Page,
  api: APIRequestContext,
  codes: "saved" | "none" = "saved",
) => {
  const { admin } = await provision(api, { name: "Calder Confirmations" });
  const { key, recoveryCodes } = await enrolledWith(api, admin.email, codes);
  await signedInWaiting(page, api, admin.email, CONFIRM_WORDS.heading);
  return { email: admin.email, key, codes: recoveryCodes };
};

/** The gate opens the Account page only to a confirmed session. */
const confirmedByCode = async (page: Page, key: string): Promise<void> => {
  await codeField(page).fill(codeOf(key));
  await landedAtHome(page, "Admin");
};

/** Ticked on the page showing them, so no later sign-in shows them again. */
const codesTicked = async (page: Page, finish: string): Promise<void> => {
  await page.getByRole("checkbox", { name: RECOVERY_CODE_WORDS.saved }).check();
  await page.getByRole("button", { name: finish }).click();
  await expect(codesListed(page)).toHaveCount(0);
};

/**
 * The add confirms its own session, so the Admin signs in by email again with the device
 * unattended, or its autofill signs in instead.
 */
const anAdminWithBothFactors = async (page: Page, api: APIRequestContext) => {
  const device = await aVirtualAuthenticator(page);
  const admin = await anAdminWithAnAuthenticator(page, api);
  await confirmedByCode(page, admin.key);
  await page.goto("/account");
  await page.getByRole("button", { name: PASSKEY_WORDS.add }).click();
  await page.getByLabel(PASSKEY_WORDS.nameField).fill("Work laptop");
  await page.getByRole("button", { name: PASSKEY_WORDS.addCommit }).click();
  await expect(
    page.getByText(ACTION_LANDED.passkeyAdded("Work laptop", admin.email)),
  ).toBeVisible();

  await device.leftUnattended();
  await signedInAgain(page, api, admin.email);
  await device.attendedAgain();
  return admin;
};

/** A recovery or restore code, sent with the button beside its field. */
const codeUsed = async (field: Locator, code: string): Promise<void> => {
  await field.fill(code);
  await field.page().getByRole("button", { name: USE_CODE }).click();
};

const recoveryCodeSpent = async (page: Page, code: string): Promise<void> => {
  await page.goto("/recovery");
  await expect(recoveryField(page)).toBeFocused();
  await codeUsed(recoveryField(page), code);
  await expect(heading(page, SETUP_WORDS.newHeading)).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
};

/** From the setup page's disclosure to its ten codes; answers the new key. */
const authenticatorSetUpThere = async (page: Page): Promise<string> => {
  await authenticatorInstead(page).click();
  const key = await keyShown(page);
  await page.getByLabel(AUTHENTICATOR_WORDS.codeField).fill(codeOf(key));
  await expect(heading(page, RECOVERY_CODE_WORDS.saveHeading)).toBeVisible();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  return key;
};

/** Wrong codes until the field must wait; answers the wait the api named, in seconds. */
const wrongCodesUntilTheWait = async (page: Page, key: string): Promise<number> => {
  for (let tried = 1; tried <= MOST_TRIES; tried += 1) {
    const answered = page.waitForResponse(CONFIRM_BY_CODE);
    await codeField(page).fill(aWrongCode(codeOf(key), tried));
    const answer = await answered;
    if (answer.status() === TOO_MANY_REQUESTS) return Number(answer.headers()["retry-after"]);
  }
  throw new Error(`${String(MOST_TRIES)} wrong codes, and the field never had to wait`);
};

test("an email-signed-in Admin confirms with the passkey offered first", async ({
  page,
  request,
}) => {
  await anAdminWithBothFactors(page, request);

  await page.goto("/confirm");

  await expect(passkeyButton(page)).toBeFocused();
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(CONFIRM_WORDS.heading)} [level=1]
      - button ${quoted(CONFIRM_WORDS.passkey)}
      - textbox ${quoted(CONFIRM_WORDS.codeField)}
      - link ${quoted(CONFIRM_WORDS.recoveryCode)}
      - button "Sign out"
  `);
  await passkeyButton(page).click();
  await landedAtHome(page, "Admin");
  await page.goto("/confirm");
  await landedAtHome(page, "Admin");
});

test("a wrong authenticator code is refused; the right one confirms", async ({ page, request }) => {
  const { key } = await anAdminWithAnAuthenticator(page, request);
  await page.goto("/confirm");
  await expect(codeField(page)).toBeFocused();

  await codeField(page).fill(aWrongCode(codeOf(key)));

  await expect(theRefusal(page)).toHaveText(sentenceOf(AUTHENTICATOR_CODE_WRONG));
  await expect(codeField(page)).toHaveAttribute("aria-invalid", "true");
  await refusedDigitsSelected(codeField(page));
  await page.keyboard.type(codeOf(key));
  await landedAtHome(page, "Admin");
});

test("repeated wrong codes make the field wait; passkeys still confirm", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { key } = await anAdminWithBothFactors(page, request);
  await page.goto("/confirm");

  const waitSeconds = await wrongCodesUntilTheWait(page, key);

  await expect(theRefusal(page)).toHaveText(
    sentenceOf(tooManyCodesTriedOr(waitSeconds, ["passkey", "recovery-code"])),
  );
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

  await recoveryCodeSpent(page, codes[0] ?? "");
  await expect(page.getByText(SETUP_WORDS.newWhy)).toBeVisible();
  await passesTheAccessibilityGate();
  const newKey = await authenticatorSetUpThere(page);

  await expect(page.getByText(RECOVERY_CODE_WORDS.replacedLine)).toBeVisible();
  await codesTicked(page, RECOVERY_CODE_WORDS.finish);
  await landedAtHome(page, "Admin");
  await signedInAgain(page, request, email);
  await page.goto("/confirm");
  await codeField(page).fill(codeOf(key));
  await expect(theRefusal(page)).toHaveText(sentenceOf(AUTHENTICATOR_CODE_WRONG));
  await codeField(page).fill(codeOf(newKey));
  await landedAtHome(page, "Admin");
});

test("after a recovery code, another email sign-in must confirm", async ({ page, request }) => {
  const { email, key, codes } = await anAdminWithAnAuthenticator(page, request);
  await recoveryCodeSpent(page, codes[0] ?? "");

  await signedInAgain(page, request, email);
  await page.goto("/setup");

  await expect(heading(page, CONFIRM_WORDS.heading)).toBeVisible();
  await expect(page).toHaveURL(/\/confirm$/);
  await codeField(page).fill(codeOf(key));
  await landedAtHome(page, "Admin");
});

test("a restored Admin gives the restore code before any setup", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { admin } = await provision(request, { name: "Restored Glazing" });
  const code = await restored(request, admin.email);
  await signedInWaiting(page, request, admin.email, SETUP_WORDS.heading);
  await expect(restoreField(page)).toBeFocused();
  await expect(addAPasskey(page)).toHaveCount(0);
  await expect(authenticatorInstead(page)).toHaveCount(0);

  await codeUsed(restoreField(page), "0000-0000-0000-0000");

  await expect(theRefusal(page)).toHaveText(sentenceOf(RESTORE_CODE_WRONG));
  await expect(authenticatorInstead(page)).toHaveCount(0);
  await passesTheAccessibilityGate();
  await page.reload();
  await expect(restoreField(page)).toBeFocused();
  await codeUsed(restoreField(page), code);
  await expect(page.getByText(SETUP_WORDS.restoreAccepted)).toBeVisible();
  await expect(restoreField(page)).toHaveCount(0);
  await authenticatorSetUpThere(page);
});

test("without WebAuthn, setup opens on the authenticator's steps", async ({ page, request }) => {
  await withoutWebAuthn(page);
  const { admin } = await provision(request, { name: "Keyless Roofing" });

  await signedInWaiting(page, request, admin.email, SETUP_WORDS.heading);

  await expect(authenticatorInstead(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("img", { name: AUTHENTICATOR_WORDS.qrCode })).toBeVisible();
  await expect(page.getByLabel(AUTHENTICATOR_WORDS.codeField)).toBeVisible();
  await expect(addAPasskey(page)).toHaveCount(0);
  await expect(page.getByText(SETUP_WORDS.passkey)).toHaveCount(0);
});

test("unticked codes come back as a new set at sign-in", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { email, key } = await anAdminWithAnAuthenticator(page, request, "none");
  await codeField(page).fill(codeOf(key));
  await expect(heading(page, RECOVERY_CODE_WORDS.saveHeading)).toBeVisible();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  await expect(page.getByText(RECOVERY_CODE_WORDS.replacedLine)).toHaveCount(0);
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
    "a code of the first set came back",
  ).toEqual([]);
  await expect(page.getByText(RECOVERY_CODE_WORDS.replacedLine)).toBeVisible();
  await passesTheAccessibilityGate();
  await codesTicked(page, RECOVERY_CODE_WORDS.finish);
  await landedAtHome(page, "Admin");

  await signedInAgain(page, request, email);
  await page.goto("/recovery");
  await codeUsed(recoveryField(page), first[0] ?? "");
  await saysItsSentenceNotItsWord(theRefusal(page), {
    table: SAID_OF_SECOND_FACTOR,
    word: "recovery-code-wrong",
  });
  await passesTheAccessibilityGate();
  await codeUsed(recoveryField(page), second[0] ?? "");
  await expect(heading(page, SETUP_WORDS.newHeading)).toBeVisible();
});
