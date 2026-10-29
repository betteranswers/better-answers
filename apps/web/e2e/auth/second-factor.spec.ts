import type { Page } from "@playwright/test";

import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  crumbOf,
  keyShown,
  keystrokesDismissed,
  keystrokesListed,
  person,
  personMenuOpened,
  provision,
  railOf,
  saysARefusal,
  signedInAtHome,
  signIn,
  signInByEmail,
  theActionLandedWithinItsBudget,
} from "../harness.ts";

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const accountHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Account" });

const regionOf = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

const authenticatorPart = (page: Page) => regionOf(page, "Authenticator");

const codesBlock = (page: Page) => regionOf(page, "Save Your Recovery Codes");

const codesListed = (page: Page) =>
  page.getByRole("list", { name: "Recovery Codes" }).getByRole("listitem");

const codeField = (page: Page) => page.getByLabel("Authenticator Code");

const setUpButton = (page: Page) =>
  page.getByRole("button", { name: "Set Up an Authenticator", exact: true });

const doneButton = (page: Page) => page.getByRole("button", { name: "Done" });

const savedBox = (page: Page) => page.getByRole("checkbox", { name: "I have saved these codes" });

const removeButton = (page: Page) =>
  authenticatorPart(page).getByRole("button", { name: "Remove", exact: true });

const outcomeOf = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });

const accountFromTheBand = async (page: Page, who: string): Promise<void> => {
  const menu = await personMenuOpened(page, who);
  await menu.getByRole("menuitem", { name: "Account" }).click();
  await expect(accountHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
};

const accountWithNoWorkspace = async (page: Page, api: Parameters<typeof person>[0]) => {
  const email = anAddress("no-workspace");
  await person(api, email);
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  await expect(accountHeading(page)).toBeVisible();
};

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

const codesSaved = async (page: Page): Promise<void> => {
  await savedBox(page).check();
  await doneClosesTheCodes(page);
};

const tenCodesInTheList = Array.from(
  { length: RECOVERY_CODES_IN_A_SET },
  () => `        - listitem: ${String(RECOVERY_CODE)}`,
).join("\n");

const anEditorOnAccount = async (page: Page, api: Parameters<typeof person>[0]) => {
  const email = anAddress("editor");
  const editor = await person(api, email, { displayName: "Ines Editor" });
  const workspace = await provision(api, { name: "Calder Joinery" });
  await addMember(api, { role: "Editor", userId: editor.id, workspaceId: workspace.workspaceId });
  await signedInAtHome(page, api, email, "Editor");
  await accountFromTheBand(page, editor.name);
  await expect(setUpButton(page)).toBeVisible();
};

test("an Editor sets up an authenticator from the avatar menu", async ({ page, request }) => {
  await anEditorOnAccount(page, request);

  const codes = await setUpWithItsCode(page);

  expect(
    codes.every((code) => RECOVERY_CODE.test(code)),
    "a code is not one the api mints",
  ).toBe(true);
  await expect(outcomeOf(page), "the page says nothing of the setup").toBeVisible();
  await expect(removeButton(page), "the page does not list the authenticator").toBeVisible();
  await expect(
    codesBlock(page).getByRole("heading", { name: "Save Your Recovery Codes" }),
  ).toBeFocused();
  await expect(codesBlock(page)).toMatchAriaSnapshot(`
    - region "Save Your Recovery Codes":
      - heading "Save Your Recovery Codes" [level=3]
      - paragraph
      - list "Recovery Codes":
${tenCodesInTheList}
      - button "Copy Codes"
      - link "Download"
      - button "Print"
      - checkbox "I have saved these codes"
      - button "Done"
  `);
});

test("Done waits for the tick, and a reload shows none", async ({ page, request }) => {
  await anEditorOnAccount(page, request);
  await setUpWithItsCode(page);

  await doneButton(page).focus();
  await clockTheNextKey(page, {
    at: `//section[h3[normalize-space(.)="Save Your Recovery Codes"]][.//*[@role='alert'][normalize-space(.)]]`,
    reads: "Save Your Recovery Codes",
  });
  await page.keyboard.press("Enter");
  await theActionLandedWithinItsBudget(page, "unticked done");
  await saysARefusal(codesBlock(page).getByRole("alert"));
  await expect(savedBox(page)).toBeFocused();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);

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

test("a setup's codes land though Set up is pressed mid-finish", async ({ page, request }) => {
  await accountWithNoWorkspace(page, request);
  const key = await setupOpened(page);
  const pressed = Promise.withResolvers<void>();
  await page.route("**/authenticator/finish", async (route) => {
    const answer = await route.fetch();
    await pressed.promise;
    await route.fulfill({ response: answer });
  });
  const asked = page.waitForRequest("**/authenticator/finish");
  await codeField(page).fill(authenticatorCodeAt(key, new Date()));
  await asked;

  await expect(setUpButton(page)).toHaveAttribute("aria-disabled", "true");
  await setUpButton(page).focus();
  await page.keyboard.press("Enter");
  pressed.resolve();

  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  await expect(
    codesBlock(page).getByRole("heading", { name: "Save Your Recovery Codes" }),
  ).toBeFocused();
});

test("a member removes their authenticator through its dialog", async ({ page, request }) => {
  await accountWithNoWorkspace(page, request);
  await setUpWithItsCode(page);
  await codesSaved(page);
  const saidOfTheSetup = await outcomeOf(page).innerText();

  await removeButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Remove Authenticator" });
  await expect(dialog, "the dialog does not say what removing does").toHaveAccessibleDescription(
    /\S/,
  );
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();

  await expect
    .poll(() => outcomeOf(page).innerText(), "the page says nothing new of the removal")
    .not.toBe(saidOfTheSetup);
  await expect(removeButton(page)).toHaveCount(0);
  await expect(setUpButton(page)).toBeFocused();
});

test("replacing the recovery codes shows a new set", async ({ page, request }) => {
  await accountWithNoWorkspace(page, request);
  const first = await setUpWithItsCode(page);
  await expect(codesBlock(page).getByRole("paragraph")).toHaveCount(1);
  await codesSaved(page);
  const saidOfTheSetup = await outcomeOf(page).innerText();

  await page.getByRole("button", { name: "Replace Recovery Codes" }).click();
  const dialog = page.getByRole("dialog", { name: "Replace Recovery Codes" });
  await expect(dialog, "the dialog does not say what replacing does").toHaveAccessibleDescription(
    /\S/,
  );
  await dialog.getByRole("button", { name: "Replace", exact: true }).click();

  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  await expect(
    codesBlock(page).getByRole("paragraph"),
    "the set does not say it replaces one",
  ).toHaveCount(2);
  await expect
    .poll(() => outcomeOf(page).innerText(), "the page says nothing new of the new set")
    .not.toBe(saidOfTheSetup);
  const second = await codesListed(page).allInnerTexts();
  expect(
    second.filter((code) => first.includes(code)),
    "a code of the first set came back",
  ).toEqual([]);
});

test("a member's Account page sits inside the shell", async ({ page, request }) => {
  await anEditorOnAccount(page, request);

  await expect(railOf(page)).toBeVisible();
  await expect(crumbOf(page, "Account")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to better-answers" })).toHaveCount(0);
  await keystrokesDismissed(page, await keystrokesListed(page, "Account"));
});

const passkeyName = (page: Page) => page.getByLabel("Passkey Name");

const authenticatorInstead = (page: Page) =>
  page.getByRole("button", { name: "Set Up an Authenticator Instead" });

const primaries = (page: Page) =>
  page.getByRole("button").and(page.locator('[data-variant="default"]'));

const anAdminOnSetup = async (page: Page, api: Parameters<typeof person>[0]): Promise<void> => {
  const { admin } = await provision(api, { name: "Skipton Setups" });
  await page.goto("/sign-in");
  await signInByEmail(page, api, admin.email);
  await expect(passkeyName(page)).toBeVisible();
};

test("setup shows one primary, whichever way is open", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await anAdminOnSetup(page, request);
  await expect(primaries(page)).toHaveText(["Add a Passkey"]);

  await authenticatorInstead(page).click();

  await expect(codeField(page)).toBeVisible();
  await expect(primaries(page)).toHaveText(["Finish Setup"]);
  await expect(passkeyName(page)).toBeHidden();
  await expect(authenticatorInstead(page)).toBeFocused();
  await passesTheAccessibilityGate();

  await authenticatorInstead(page).click();

  await expect(passkeyName(page)).toBeVisible();
  await expect(primaries(page)).toHaveText(["Add a Passkey"]);
  await expect(authenticatorInstead(page)).toBeFocused();
});
