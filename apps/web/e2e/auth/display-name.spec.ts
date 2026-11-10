import type { Page } from "@playwright/test";

import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace/workspace-words.ts";
import { DISPLAY_NAME_WORDS } from "@/shared/member/display-name-words.ts";

import { expect, test } from "../browser.ts";
import { anAddress, clockTheNextKey, signIn, actionWithinBudget } from "../harness.ts";

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: DISPLAY_NAME_WORDS.heading });

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING });

const displayNameField = (page: Page) => page.getByLabel(DISPLAY_NAME_WORDS.label);

const saveButton = (page: Page) => page.getByRole("button", { name: DISPLAY_NAME_WORDS.save });

test("asks a new person for a display name first", async ({
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
      - heading ${JSON.stringify(DISPLAY_NAME_WORDS.heading)} [level=1]
      - paragraph
      - textbox ${JSON.stringify(DISPLAY_NAME_WORDS.label)}
      - button ${JSON.stringify(DISPLAY_NAME_WORDS.save)}
  `);
  await passesTheAccessibilityGate();
  const ring = await displayNameField(page).evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  expect(ring, "the focused field shows no focus ring").not.toBe("none");

  await page.keyboard.press("Tab");
  await expect(saveButton(page), "Tab from the field did not reach Save").toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(displayNameField(page)).toBeFocused();

  await page.keyboard.type("Priya Shah");
  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Saving" });
  await page.keyboard.press("Enter");
  await actionWithinBudget(page, "display name save");

  await expect(noWorkspaceHeading(page)).toBeVisible();
});
