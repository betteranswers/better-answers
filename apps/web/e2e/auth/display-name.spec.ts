import type { Page } from "@playwright/test";

import { DISPLAY_NAME_MAX_CHARACTERS } from "@/shared/member/display-name-words.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  clockTheNextKey,
  keepsItsWordOffThePage,
  saysSomethingNew,
  saysARefusal,
  signIn,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Your Name" });

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No Workspace Yet" });

const displayNameField = (page: Page) => page.getByLabel("Display Name");

const saveButton = (page: Page) => page.getByRole("button", { name: "Save and Continue" });

const SET_DISPLAY_NAME = "person.setDisplayName";

test("asks a first-time person for a display name before anything", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await page.goto("/sign-in");
  await signIn(page, request, anAddress("first"));

  await expect(displayNameHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/display-name$/);
  await expect(displayNameField(page)).toBeFocused();
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Your Name" [level=1]
      - paragraph
      - textbox "Display Name"
      - button "Save and Continue"
  `);
  await passesTheAccessibilityGate();
  const ring = await displayNameField(page).evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  expect(ring, "the focused field shows no focus ring").not.toBe("none");

  await page.keyboard.type("Priya Shah");
  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Saving" });
  await page.keyboard.press("Enter");
  await theActionLandedWithinItsBudget(page, "display name save");

  await expect(noWorkspaceHeading(page)).toBeVisible();
});

test("says what to change in a bad name, then saves", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await page.goto("/sign-in");
  await signIn(page, request, anAddress("refused"));
  await expect(displayNameHeading(page)).toBeVisible();

  const refusal = page.getByRole("alert", { includeHidden: true });
  await expect(refusal, "the display-name page stands no refusal region").toHaveCount(1);
  await expect(refusal, "the refusal region stands with words already in it").toBeEmpty();
  const stood = await refusal.elementHandle();

  await displayNameField(page).fill("Priya <priya@acme.invalid>");
  const bracketed = refusalAnswering(page, SET_DISPLAY_NAME);
  await saveButton(page).click();

  expect(await bracketed).toMatchObject({ word: "display-name-angle-bracket" });
  await saysARefusal(refusal);
  const said = await refusal.innerText();
  await keepsItsWordOffThePage(page, "display-name-angle-bracket");
  const sameRegion = await refusal.evaluate((now, then) => now === then, stood);
  expect(sameRegion, "the refusal was said in an alert region of its own").toBe(true);
  await expect(displayNameField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(displayNameHeading(page)).toBeVisible();
  await passesTheAccessibilityGate();

  await displayNameField(page).fill("a".repeat(DISPLAY_NAME_MAX_CHARACTERS + 1));
  const tooLong = refusalAnswering(page, SET_DISPLAY_NAME);
  await saveButton(page).click();
  expect(await tooLong).toMatchObject({ word: "display-name-too-long" });
  await saysSomethingNew(refusal, said);

  await displayNameField(page).fill("Priya Shah");
  await saveButton(page).click();
  await expect(noWorkspaceHeading(page)).toBeVisible();
});
