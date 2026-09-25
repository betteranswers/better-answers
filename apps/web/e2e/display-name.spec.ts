import type { Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheAct,
  person,
  provision,
  signIn,
  theActReadWithinItsBudget,
} from "./harness.ts";

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Your display name" });

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No workspace yet" });

const displayNameField = (page: Page) => page.getByLabel("Display name");

const saveButton = (page: Page) => page.getByRole("button", { name: "Save and continue" });

// Every screen the page was shown, so a screen that came and went cannot pass unseen.
const screensShown = (page: Page): readonly string[] => {
  const shown: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) shown.push(new URL(frame.url()).pathname);
  });
  return shown;
};

test("a person signing in for the first time gives a display name before anything else, then meets No workspace yet", async ({
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
  await clockTheAct(page, "Saving");
  await page.keyboard.press("Enter");
  await theActReadWithinItsBudget(page, "display name save");

  await expect(noWorkspaceHeading(page)).toBeVisible();
});

test("the name a person gives is the one the shell credits them by once an Admin adds them, and they are never asked again", async ({
  page,
  request,
}) => {
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

  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);
  const bar = page.getByRole("banner");
  await expect(bar.getByText("Theo Approver", { exact: false })).toBeVisible();
  expect(shown).not.toContain("/display-name");
});

test("a member who has a display name signs in straight to the shell and is never asked for one", async ({
  page,
  request,
}) => {
  const email = anAddress("already");
  await provision(request, { name: "Already Named", adminEmail: email });
  const shown = screensShown(page);

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);
  expect(shown).not.toContain("/display-name");
  await page.goto("/display-name");
  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);
});

test("a name the platform refuses is shown as its own word with what to do next, and a name it takes carries the person on", async ({
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

test("the display-name screen sends a visitor with no session to sign in", async ({ page }) => {
  await page.goto("/display-name");

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a save made after the session ended says so in its word, and offers the way back to sign in", async ({
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
