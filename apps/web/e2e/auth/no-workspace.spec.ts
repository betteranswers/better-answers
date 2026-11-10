import type { Page } from "@playwright/test";

import {
  ASK_TO_JOIN_WORDS,
  REASON_MAX_CHARACTERS,
} from "@/features/auth/workspace/ask-to-join-words.ts";
import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace/workspace-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { SIGN_OUT } from "@/shared/words.ts";

import { expect, test } from "../browser.ts";
import {
  clockTheNextKey,
  provision,
  signedInWithNoWorkspace,
  actionWithinBudget,
} from "../harness.ts";

const REASON = "I run the estimating desk and need the tender library.";

const shortNameField = (page: Page) => page.getByLabel(ASK_TO_JOIN_WORDS.shortName);

const reasonField = (page: Page) => page.getByLabel("Reason");

const requestSent = (page: Page) => page.getByRole("alert", { name: ASK_TO_JOIN_WORDS.sent });

test("a person with no workspace asks to join by keyboard", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Acme Joinery" });
  await signedInWithNoWorkspace(page, request, "asker");

  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${JSON.stringify(NO_WORKSPACE_HEADING)} [level=1]
      - region ${JSON.stringify(ASK_TO_JOIN_WORDS.heading)}:
        - heading ${JSON.stringify(ASK_TO_JOIN_WORDS.heading)} [level=2]
        - paragraph
        - textbox ${JSON.stringify(ASK_TO_JOIN_WORDS.shortName)}
        - paragraph
        - textbox "Reason"
        - button ${JSON.stringify(ASK_TO_JOIN_WORDS.ask)}
      - button ${JSON.stringify(SIGN_OUT)}
      - button ${JSON.stringify(KEYSTROKE_WORDS.button)}
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
    - alert ${JSON.stringify(ASK_TO_JOIN_WORDS.sent)}:
      - paragraph
      - paragraph
  `);
  await expect(shortNameField(page)).toHaveValue("");
  await expect(reasonField(page)).toHaveValue("");
});
