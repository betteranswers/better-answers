import type { Page } from "@playwright/test";

import { REASON_MAX_CHARACTERS } from "@/features/auth/workspace/ask-to-join-words.ts";

import { expect, test } from "../browser.ts";
import {
  clockTheNextKey,
  provision,
  saysARefusal,
  signedInWithNoWorkspace,
  signInHeading,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const ASK_TO_JOIN = "person.requestAccess";

const REASON = "I run the estimating desk and need the tender library.";

const A_SHORT_NAME = "acme-joinery";

const OLD_WORD = ["sl", "ug"].join("");

const UNSAID = [
  { word: "an organisation", pattern: /organi[sz]ation/i },
  { word: `a ${OLD_WORD}`, pattern: new RegExp(String.raw`\b${OLD_WORD}\b`, "i") },
] as const;

const askRegion = (page: Page) => page.getByRole("region", { name: "Ask to Join a Workspace" });

const shortNameField = (page: Page) => page.getByLabel("Workspace Short Name");

const reasonField = (page: Page) => page.getByLabel("Reason");

const askButton = (page: Page) =>
  askRegion(page).getByRole("button", { name: /^(Ask to Join|Asking)$/ });

const requestSent = (page: Page) => page.getByRole("alert", { name: "Request sent" });

const askToJoin = async (page: Page, shortName: string, reason = REASON): Promise<void> => {
  await shortNameField(page).fill(shortName);
  await reasonField(page).fill(reason);
  await askButton(page).click();
};

const thePageSaysNeither = async (page: Page, when: string): Promise<void> => {
  const said = `${await page.locator("body").innerText()}\n${await page.locator("body").ariaSnapshot()}`;
  for (const { word, pattern } of UNSAID) {
    expect(said, `the no-workspace page names ${word} ${when}`).not.toMatch(pattern);
  }
};

test("a person in no workspace asks to join by keyboard", async ({
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
  await expect(shortNameField(page), "the field shows no example").toHaveAccessibleDescription(
    /acme-joinery/,
  );
  await expect(reasonField(page), "the field names no limit").toHaveAccessibleDescription(
    new RegExp(REASON_MAX_CHARACTERS.toLocaleString("en-GB")),
  );
  await passesTheAccessibilityGate();

  await page.keyboard.press("j");
  await expect(shortNameField(page)).toBeFocused();
  await page.keyboard.type(workspace.shortName);
  await page.keyboard.press("Tab");
  await expect(reasonField(page)).toBeFocused();
  await page.keyboard.type(REASON);
  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Asking" });
  await page.keyboard.press("Enter");
  await theActionLandedWithinItsBudget(page, "ask to join");

  await expect(requestSent(page)).toBeFocused();
  await expect(requestSent(page)).toMatchAriaSnapshot(`
    - alert "Request sent":
      - paragraph
      - paragraph
  `);
  await expect(shortNameField(page)).toHaveValue("");
  await expect(reasonField(page)).toHaveValue("");
});

test("refuses a blank reason, saying what to send", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Coldharbour Fabrication" });
  await signedInWithNoWorkspace(page, request, "asker");

  const refusal = askRegion(page).getByRole("alert", { includeHidden: true });
  await expect(refusal, "the refusal region does not stand before an ask").toHaveCount(1);
  await expect(refusal, "the refusal region stands with words already in it").toBeEmpty();
  const stood = await refusal.elementHandle();

  const refused = refusalAnswering(page, ASK_TO_JOIN);
  await askToJoin(page, workspace.shortName, "   ");

  expect(await refused).toMatchObject({ word: "malformed", class: "malformed" });
  await saysARefusal(refusal);
  const sameRegion = await refusal.evaluate((now, then) => now === then, stood);
  expect(sameRegion, "the refusal came in an alert region of its own").toBe(true);
  await expect(reasonField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(reasonField(page)).toBeFocused();
  await expect(requestSent(page)).toHaveCount(0);
  await thePageSaysNeither(page, "in a refusal");
  await passesTheAccessibilityGate();
});

test("sends a person whose session ended back to sign in", async ({ page, context, request }) => {
  await signedInWithNoWorkspace(page, request, "asker");
  await context.clearCookies();

  const refused = refusalAnswering(page, ASK_TO_JOIN);
  await askToJoin(page, A_SHORT_NAME);

  expect(await refused).toMatchObject({ class: "unauthenticated" });
  await saysARefusal(page.getByRole("alert"));
  await thePageSaysNeither(page, "once the session ended");
  await page.getByRole("button", { name: "Sign In Again" }).click();
  await expect(signInHeading(page)).toBeVisible();
});
