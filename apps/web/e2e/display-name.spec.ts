import type { Page } from "@playwright/test";

import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace-words.ts";
import {
  DISPLAY_NAME_MAX_CHARACTERS,
  DISPLAY_NAME_REFUSED,
  DISPLAY_NAME_WORDS,
} from "@/shared/display-name-words.ts";
import { SAID_OF_CLASS, sentenceOf, SIGN_IN_AGAIN } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  landedAtHome,
  person,
  provision,
  saysItsSentenceNotItsWord,
  signIn,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: DISPLAY_NAME_WORDS.heading });

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING });

const displayNameField = (page: Page) => page.getByLabel(DISPLAY_NAME_WORDS.label);

const saveButton = (page: Page) => page.getByRole("button", { name: "Save and continue" });

/** Every page the browser was shown, so a page that came and went cannot pass unseen. */
const pagesShown = (page: Page): readonly string[] => {
  const shown: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) shown.push(new URL(frame.url()).pathname);
  });
  return shown;
};

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
      - heading ${JSON.stringify(DISPLAY_NAME_WORDS.heading)} [level=1]
      - paragraph: ${JSON.stringify(DISPLAY_NAME_WORDS.hint)}
      - text: ${JSON.stringify(DISPLAY_NAME_WORDS.label)}
      - textbox ${JSON.stringify(DISPLAY_NAME_WORDS.label)}
      - button "Save and continue"
  `);
  await passesTheAccessibilityGate();
  const ring = await displayNameField(page).evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  expect(ring, "the focused field shows no focus ring").not.toBe("none");

  await page.keyboard.type("Priya Shah");
  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Saving" });
  await page.keyboard.press("Enter");
  await theActLandedWithinItsBudget(page, "display name save");

  await expect(noWorkspaceHeading(page)).toBeVisible();
});

test("credits a new member by their given name, asking once", async ({ page, request }) => {
  const email = anAddress("named");
  const who = await person(request, email, { displayName: "" });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await displayNameField(page).fill("Theo Approver");
  await saveButton(page).click();
  await expect(noWorkspaceHeading(page)).toBeVisible();

  const workspace = await provision(request, { name: "Named Ltd" });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: who.id, role: "Editor" });
  const shown = pagesShown(page);
  await page.goto("/choose-workspace");

  await landedAtHome(page, "Editor");
  const bar = page.getByRole("banner");
  await expect(bar.getByText("Theo Approver", { exact: false })).toBeVisible();
  expect(shown).not.toContain("/display-name");
});

// An Editor, since an Admin's sign-in passes the second-factor pages first.
test("signs a named member straight into the shell, never asking", async ({ page, request }) => {
  const email = anAddress("already");
  const who = await person(request, email, { displayName: "Alys Named" });
  const workspace = await provision(request, { name: "Already Named" });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: who.id, role: "Editor" });
  const shown = pagesShown(page);

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await landedAtHome(page, "Editor");
  expect(shown).not.toContain("/display-name");
  await page.goto("/display-name");
  await landedAtHome(page, "Editor");
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
  await saveButton(page).click();

  await saysItsSentenceNotItsWord(refusal, {
    table: DISPLAY_NAME_REFUSED,
    word: "display-name-angle-bracket",
  });
  const sameRegion = await refusal.evaluate((now, then) => now === then, stood);
  expect(sameRegion, "the refusal was said in an alert region of its own").toBe(true);
  await expect(displayNameField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(displayNameHeading(page)).toBeVisible();
  await passesTheAccessibilityGate();

  await displayNameField(page).fill("a".repeat(DISPLAY_NAME_MAX_CHARACTERS + 1));
  await saveButton(page).click();
  await expect(refusal).toHaveText(sentenceOf(DISPLAY_NAME_REFUSED["display-name-too-long"]));

  await displayNameField(page).fill("Priya Shah");
  await saveButton(page).click();
  await expect(noWorkspaceHeading(page)).toBeVisible();
});

test("sends a signed-out visitor from the display-name page to sign-in", async ({ page }) => {
  await page.goto("/display-name");

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("refuses a save after the session ended, offering sign-in again", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/sign-in");
  await signIn(page, request, anAddress("ended"));
  await expect(displayNameHeading(page)).toBeVisible();
  await context.clearCookies();

  await displayNameField(page).fill("Priya Shah");
  await saveButton(page).click();

  await expect(page.getByRole("alert")).toHaveText(SAID_OF_CLASS.unauthenticated.why);
  await expect(displayNameField(page)).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: SIGN_IN_AGAIN }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
