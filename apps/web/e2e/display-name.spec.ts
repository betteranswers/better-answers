import type { Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  landedAtHome,
  person,
  provision,
  signIn,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Your display name" });

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No workspace yet" });

const displayNameField = (page: Page) => page.getByLabel("Display name");

const saveButton = (page: Page) => page.getByRole("button", { name: "Save and continue" });

/** Every screen the page was shown, so a screen that came and went cannot pass unseen. */
const screensShown = (page: Page): readonly string[] => {
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
      - heading "Your display name" [level=1]
      - paragraph: "The one line the platform credits you by wherever it names you: on a check you make, as the author of a change, in a member list. Up to 100 characters."
      - text: Display name
      - textbox "Display name"
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
  const shown = screensShown(page);
  await page.goto("/choose-workspace");

  await landedAtHome(page, "Editor");
  const bar = page.getByRole("banner");
  await expect(bar.getByText("Theo Approver", { exact: false })).toBeVisible();
  expect(shown).not.toContain("/display-name");
});

test("signs a named member straight into the shell, never asking", async ({ page, request }) => {
  const email = anAddress("already");
  await provision(request, { name: "Already Named", adminEmail: email });
  const shown = screensShown(page);

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await landedAtHome(page, "Admin");
  expect(shown).not.toContain("/display-name");
  await page.goto("/display-name");
  await landedAtHome(page, "Admin");
});

test("refuses a bad name by its word, then accepts one", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await page.goto("/sign-in");
  await signIn(page, request, anAddress("refused"));
  await expect(displayNameHeading(page)).toBeVisible();

  await displayNameField(page).fill("Priya <priya@acme.invalid>");
  await saveButton(page).click();

  const refusal = page.getByRole("alert");
  await expect(refusal).toContainText("display-name-angle-bracket");
  await expect(refusal).toContainText(
    "A display name cannot hold < or >. Remove them and save again.",
  );
  await expect(displayNameField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(displayNameHeading(page)).toBeVisible();
  await passesTheAccessibilityGate();

  await displayNameField(page).fill("a".repeat(101));
  await saveButton(page).click();
  await expect(refusal).toContainText("display-name-too-long");
  await expect(refusal).toContainText("A display name is at most 100 characters.");

  await displayNameField(page).fill("Priya Shah");
  await saveButton(page).click();
  await expect(noWorkspaceHeading(page)).toBeVisible();
});

test("sends a signed-out visitor from the display-name screen to sign-in", async ({ page }) => {
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

  const refusal = page.getByRole("alert");
  await expect(refusal).toContainText("no-session");
  await expect(refusal).toContainText("Your session has ended. Sign in again.");
  await expect(displayNameField(page)).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
