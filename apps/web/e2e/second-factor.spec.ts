import type { Page } from "@playwright/test";

import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import {
  ACCOUNT_HEADING,
  ACCOUNT_WORDS,
  ACT_LANDED,
  AUTHENTICATOR_WORDS,
  codesLeft,
  RECOVERY_CODE_WORDS,
} from "@/features/auth/account-words.ts";
import {
  CODES_NOT_TICKED,
  SAID_OF_SECOND_FACTOR,
  SETUP_CODE_WRONG,
} from "@/features/auth/refusal-words.ts";
import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { CONSOLE, HOMES } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  clockTheNextKey,
  keystrokesDismissed,
  keystrokesListed,
  markTheOperator,
  person,
  personMenuOpened,
  provision,
  quoted,
  signIn,
  signedInAtHome,
  theActLandedWithinItsBudget,
} from "./harness.ts";

/** A recovery code as the api mints it: four groups of four, none of them easy to misread. */
const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

/** The key in fours, as the page writes it out for typing into a phone. */
const KEY_IN_FOURS = /^[A-Z2-7]{4}(?: [A-Z2-7]{1,4})+$/;

const accountHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: ACCOUNT_HEADING });

const regionOf = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

const authenticatorPart = (page: Page) => regionOf(page, AUTHENTICATOR_WORDS.heading);

const codesBlock = (page: Page) => regionOf(page, RECOVERY_CODE_WORDS.saveHeading);

const codesListed = (page: Page) =>
  page.getByRole("list", { name: RECOVERY_CODE_WORDS.list }).getByRole("listitem");

const codeField = (page: Page) => page.getByLabel(AUTHENTICATOR_WORDS.codeField);

const setUpButton = (page: Page) => page.getByRole("button", { name: AUTHENTICATOR_WORDS.setUp });

const doneButton = (page: Page) => page.getByRole("button", { name: RECOVERY_CODE_WORDS.done });

const savedBox = (page: Page) => page.getByRole("checkbox", { name: RECOVERY_CODE_WORDS.saved });

const aWrongCode = (right: string): string => (right === "000000" ? "111111" : "000000");

const accountFromTheBand = async (page: Page, who: string): Promise<void> => {
  const menu = await personMenuOpened(page, who);
  await menu.getByRole("menuitem", { name: ACCOUNT_HEADING }).click();
  await expect(accountHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
};

/** A person in no workspace reaches the page from the screen they land on. */
const accountWithNoWorkspace = async (page: Page, api: Parameters<typeof person>[0]) => {
  const email = anAddress("no-workspace");
  await person(api, email);
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  await page.getByRole("link", { name: ACCOUNT_HEADING }).click();
  await expect(accountHeading(page)).toBeVisible();
  return email;
};

/** Read off the page as a person would type it into their phone, spaces and all. */
const keyShown = async (page: Page): Promise<string> =>
  (await page.getByText(KEY_IN_FOURS).innerText()).replaceAll(" ", "");

const setupOpened = async (page: Page): Promise<string> => {
  await setUpButton(page).click();
  await expect(page.getByRole("img", { name: AUTHENTICATOR_WORDS.qrCode })).toBeVisible();
  return keyShown(page);
};

/** Six digits finish the setup on their own, as a sign-in code does. */
const setUpWithItsCode = async (page: Page): Promise<readonly string[]> => {
  const key = await setupOpened(page);
  await codeField(page).fill(authenticatorCodeAt(key, new Date()));
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  return codesListed(page).allInnerTexts();
};

/** Done hands focus to the heading over the count of codes left, which takes the block's place. */
const doneClosesTheCodes = async (page: Page): Promise<void> => {
  await doneButton(page).click();
  await expect(codesBlock(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 3, name: RECOVERY_CODE_WORDS.heading }),
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

test("an Admin sets up an authenticator from the avatar menu", async ({ page, request }) => {
  const workspace = await provision(request, { name: "Calder Joinery" });
  await signedInAtHome(page, request, workspace.admin.email);
  await accountFromTheBand(page, workspace.admin.name);
  await expect(authenticatorPart(page)).toContainText(AUTHENTICATOR_WORDS.none);

  const codes = await setUpWithItsCode(page);

  expect(
    codes.every((code) => RECOVERY_CODE.test(code)),
    "a code is not one the api mints",
  ).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: AUTHENTICATOR_WORDS.held })).toHaveText(
    ACT_LANDED.setUp(workspace.admin.email),
  );
  await expect(
    codesBlock(page).getByRole("heading", { name: RECOVERY_CODE_WORDS.saveHeading }),
  ).toBeFocused();
  await expect(codesBlock(page)).toMatchAriaSnapshot(`
    - region ${quoted(RECOVERY_CODE_WORDS.saveHeading)}:
      - heading ${quoted(RECOVERY_CODE_WORDS.saveHeading)} [level=3]
      - paragraph: ${quoted(RECOVERY_CODE_WORDS.saveLine)}
      - list ${quoted(RECOVERY_CODE_WORDS.list)}:
${tenCodesInTheList}
      - button ${quoted(RECOVERY_CODE_WORDS.copy)}
      - link ${quoted(RECOVERY_CODE_WORDS.download)}
      - button ${quoted(RECOVERY_CODE_WORDS.print)}
      - checkbox ${quoted(RECOVERY_CODE_WORDS.saved)}
      - text: ${quoted(RECOVERY_CODE_WORDS.saved)}
      - button ${quoted(RECOVERY_CODE_WORDS.done)}
  `);
});

test("Done waits for the tick, and a reload shows none", async ({ page, request }) => {
  const workspace = await provision(request, { name: "Pennine Metalwork" });
  await signedInAtHome(page, request, workspace.admin.email);
  await accountFromTheBand(page, workspace.admin.name);
  await setUpWithItsCode(page);

  await doneButton(page).focus();
  await clockTheNextKey(page, {
    at: `//section[h3[normalize-space(.)=${quoted(RECOVERY_CODE_WORDS.saveHeading)}]]//*[@role='alert']`,
    reads: CODES_NOT_TICKED.why,
  });
  await page.keyboard.press("Enter");
  await theActLandedWithinItsBudget(page, "unticked done");
  await expect(codesBlock(page).getByRole("alert")).toHaveText(sentenceOf(CODES_NOT_TICKED));
  await expect(savedBox(page)).toBeFocused();
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);

  await page.keyboard.press("Space");
  await expect(savedBox(page)).toBeChecked();
  await doneClosesTheCodes(page);

  const left = codesLeft(RECOVERY_CODES_IN_A_SET, new Date().toISOString());
  const recoveryCodes = regionOf(page, RECOVERY_CODE_WORDS.heading);
  await expect(recoveryCodes).toContainText(left);
  const remove = authenticatorPart(page).getByRole("button", { name: AUTHENTICATOR_WORDS.remove });
  await expect(remove).toHaveAttribute("aria-disabled", "true");
  await expect(remove).toHaveAccessibleDescription(
    sentenceOf(SAID_OF_SECOND_FACTOR["last-second-factor"]),
  );
  await remove.press("Enter");
  await expect(remove).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.reload();
  await expect(recoveryCodes).toContainText(left);
  await expect(authenticatorPart(page)).toContainText(AUTHENTICATOR_WORDS.held);
  await expect(codesListed(page)).toHaveCount(0);
});

test("a wrong setup code is refused, its digits left selected", async ({ page, request }) => {
  await accountWithNoWorkspace(page, request);
  // The key is bound once the read says there is no authenticator, which the button shows.
  await expect(setUpButton(page)).toBeVisible();
  await page.keyboard.press("s");
  await expect(page.getByRole("img", { name: AUTHENTICATOR_WORDS.qrCode })).toBeVisible();
  const key = await keyShown(page);

  await codeField(page).fill(aWrongCode(authenticatorCodeAt(key, new Date())));

  await expect(authenticatorPart(page).getByRole("alert")).toHaveText(sentenceOf(SETUP_CODE_WRONG));
  await expect(codeField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(codeField(page)).toBeFocused();
  const selected = await codeField(page).evaluate((field) =>
    field instanceof HTMLInputElement ? [field.selectionStart, field.selectionEnd] : [],
  );
  expect(selected, "the refused digits are not selected for retyping").toEqual([0, 6]);

  await page.keyboard.type(authenticatorCodeAt(key, new Date()));
  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
});

test("a member removes their authenticator through its dialog", async ({ page, request }) => {
  const email = await accountWithNoWorkspace(page, request);
  await setUpWithItsCode(page);
  await codesSaved(page);

  await authenticatorPart(page).getByRole("button", { name: AUTHENTICATOR_WORDS.remove }).click();
  const dialog = page.getByRole("dialog", { name: AUTHENTICATOR_WORDS.removeTitle });
  await expect(dialog).toContainText(AUTHENTICATOR_WORDS.removeConsequence);
  await dialog.getByRole("button", { name: AUTHENTICATOR_WORDS.removeCommit }).click();

  await expect(page.getByRole("status").filter({ hasText: email })).toHaveText(
    ACT_LANDED.removed(email),
  );
  await expect(authenticatorPart(page)).toContainText(AUTHENTICATOR_WORDS.none);
  await expect(setUpButton(page)).toBeFocused();
});

test("replacing the recovery codes shows a new set", async ({ page, request }) => {
  const email = await accountWithNoWorkspace(page, request);
  const first = await setUpWithItsCode(page);
  await codesSaved(page);

  await page.getByRole("button", { name: RECOVERY_CODE_WORDS.replace }).click();
  const dialog = page.getByRole("dialog", { name: RECOVERY_CODE_WORDS.replaceTitle });
  await expect(dialog).toContainText(RECOVERY_CODE_WORDS.replaceConsequence);
  await dialog.getByRole("button", { name: RECOVERY_CODE_WORDS.replaceCommit }).click();

  await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
  await expect(codesBlock(page)).toContainText(RECOVERY_CODE_WORDS.replacedLine);
  await expect(page.getByRole("status").filter({ hasText: email })).toHaveText(
    ACT_LANDED.replaced(email),
  );
  const second = await codesListed(page).allInnerTexts();
  expect(
    second.filter((code) => first.includes(code)),
    "a code of the first set came back",
  ).toEqual([]);
});

test("the operator reaches Account from the console's avatar menu", async ({ page, request }) => {
  const email = anAddress("operator");
  const workspace = await provision(request, { name: "Wharfedale Castings", adminEmail: email });
  await markTheOperator(request, email);
  await signedInAtHome(page, request, email);
  await page.goto(HOMES.operator.path);
  await expect(page.getByRole("navigation", { name: CONSOLE.name })).toBeVisible();

  await accountFromTheBand(page, workspace.admin.name);
  await expect(authenticatorPart(page)).toContainText(AUTHENTICATOR_WORDS.none);
});

test("a signed-out visitor signs in and lands back on Account", async ({ page, request }) => {
  const email = anAddress("returning");
  await person(request, email);
  await page.goto("/account");
  await signIn(page, request, email);

  await expect(accountHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(ACCOUNT_HEADING)} [level=1]
      - region ${quoted(ACCOUNT_WORDS.signIn)}:
        - heading ${quoted(ACCOUNT_WORDS.signIn)} [level=2]
        - region ${quoted(AUTHENTICATOR_WORDS.heading)}:
          - heading ${quoted(AUTHENTICATOR_WORDS.heading)} [level=3]
          - paragraph: ${quoted(AUTHENTICATOR_WORDS.none)}
          - button ${quoted(AUTHENTICATOR_WORDS.setUp)} [expanded=false]
      - link ${quoted(ACCOUNT_WORDS.goOn)}
      - button "Sign out"
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);

  const listed = await keystrokesListed(page, ACCOUNT_HEADING);
  await expect(listed).toContainText(AUTHENTICATOR_WORDS.setUp);
  await keystrokesDismissed(page, listed);
});
