import type { Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import { anAddress, clockTheNextKey, signIn, theActionLandedWithinItsBudget } from "../harness.ts";

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Your Name" });

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No Workspace Yet" });

const displayNameField = (page: Page) => page.getByLabel("Display Name");

const saveButton = (page: Page) => page.getByRole("button", { name: "Save and Continue" });

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

  await page.keyboard.press("Tab");
  await expect(saveButton(page), "Tab left the field without reaching Save").toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(displayNameField(page)).toBeFocused();

  await page.keyboard.type("Priya Shah");
  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Saving" });
  await page.keyboard.press("Enter");
  await theActionLandedWithinItsBudget(page, "display name save");

  await expect(noWorkspaceHeading(page)).toBeVisible();
});
