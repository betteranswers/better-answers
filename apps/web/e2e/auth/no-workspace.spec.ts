import type { Page } from "@playwright/test";

import { REASON_MAX_CHARACTERS } from "@/features/auth/workspace/ask-to-join-words.ts";

import { expect, test } from "../browser.ts";
import {
  clockTheNextKey,
  provision,
  signedInWithNoWorkspace,
  actionWithinBudget,
} from "../harness.ts";

const REASON = "I run the estimating desk and need the tender library.";

const shortNameField = (page: Page) => page.getByLabel("Workspace Short Name");

const reasonField = (page: Page) => page.getByLabel("Reason");

const requestSent = (page: Page) => page.getByRole("alert", { name: "Request Sent" });

test("a person with no workspace asks to join by keyboard", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Acme Joinery" });
  await signedInWithNoWorkspace(page, request, "asker");

  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "No Workspace Yet" [level=1]
      - region "Ask to Join a Workspace":
        - heading "Ask to Join a Workspace" [level=2]
        - paragraph
        - textbox "Workspace Short Name"
        - paragraph
        - textbox "Reason"
        - button "Ask to Join"
      - button "Sign Out"
      - button "Keyboard Shortcuts"
  `);
  await expect(
    shortNameField(page),
    "Workspace Short Name gives no example",
  ).toHaveAccessibleDescription(/acme-joinery/);
  await expect(
    reasonField(page),
    "Reason does not state its character limit",
  ).toHaveAccessibleDescription(new RegExp(REASON_MAX_CHARACTERS.toLocaleString("en-GB")));
  await passesTheAccessibilityGate();

  await page.keyboard.press("j");
  await expect(shortNameField(page)).toBeFocused();
  await page.keyboard.type(workspace.shortName);
  await page.keyboard.press("Tab");
  await expect(reasonField(page)).toBeFocused();
  await page.keyboard.type(REASON);
  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Asking" });
  await page.keyboard.press("Enter");
  await actionWithinBudget(page, "ask to join");

  await expect(requestSent(page)).toBeFocused();
  await expect(requestSent(page)).toMatchAriaSnapshot(`
    - alert "Request Sent":
      - paragraph
      - paragraph
  `);
  await expect(shortNameField(page)).toHaveValue("");
  await expect(reasonField(page)).toHaveValue("");
});
