import type { APIRequestContext, Page } from "@playwright/test";

import type { Role } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  clockTheNextKey,
  invite,
  keystrokesDismissed,
  keystrokesListed,
  person,
  personMenuOpened,
  provision,
  signIn,
  signInHeading,
  theActionLandedWithinItsBudget,
} from "../harness.ts";

const READ_BUDGET_MS = 1000;

const INVITER = "Morgan Reid";

const invitationHeading = (page: Page, workspace: string) =>
  page.getByRole("heading", { level: 1, name: `Your Invitation to ${workspace}` });

const joinButton = (page: Page) => page.getByRole("button", { name: "Join Workspace" });

const nameField = (page: Page) => page.getByLabel("Display Name");

const invitedAs = (page: Page, role: Role) =>
  page
    .getByRole("main")
    .getByRole("paragraph")
    .filter({
      hasText: new RegExp(String.raw`${INVITER}(?:(?!Admin|Editor|Viewer).)*${role}\b`),
    });

const anInvitation = async (request: APIRequestContext, workspaceName: string, role: Role) => {
  const workspace = await provision(request, { name: workspaceName });
  const inviter = await person(request, anAddress("morgan"), { displayName: INVITER });
  const address = anAddress("priya");
  const invited = await invite(request, {
    workspaceId: workspace.workspaceId,
    email: address,
    inviterId: inviter.id,
    role,
  });
  return { workspace, address, link: `/invitations/${invited.id}` };
};

test("an invited newcomer names themselves on the invitation, then joins", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Calder Joinery", "Editor");

  await page.goto(link);
  await expect(signInHeading(page, "joining")).toBeVisible();
  await signIn(page, request, address);

  await expect(invitationHeading(page, "Calder Joinery")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${link}$`));
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Your Invitation to Calder Joinery" [level=1]
      - paragraph
      - paragraph
      - textbox "Display Name"
      - button "Join Workspace"
      - button "Sign Out"
      - button "Keyboard Shortcuts"
  `);
  await expect(invitedAs(page, "Editor")).toBeVisible();
  await passesTheAccessibilityGate();

  const keystrokes = await keystrokesListed(page, "This Page");
  await expect(keystrokes.getByRole("term").filter({ hasText: /^j$/ })).toBeVisible();
  await keystrokesDismissed(page, keystrokes);

  await nameField(page).fill("Priya Shah");
  await page.keyboard.press("Tab");
  await expect(joinButton(page)).toBeFocused();
  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Joining" });
  await page.keyboard.press("j");
  await theActionLandedWithinItsBudget(page, "name and accept");

  const bar = page.getByRole("banner");
  await expect(bar.getByText("Calder Joinery")).toBeVisible();
  await expect(await personMenuOpened(page, "Priya Shah")).toContainText("Editor");
});

test("a named invitee reads it within a second, joins keyboard-only", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Ryedale Metalwork", "Viewer");
  await person(request, address, { displayName: "Sam Okoro" });
  await page.goto(link);
  await signIn(page, request, address);
  await expect(invitationHeading(page, "Ryedale Metalwork")).toBeVisible();

  const started = Date.now();
  await page.goto(link);
  await expect(joinButton(page)).toBeVisible();
  const elapsedMs = Date.now() - started;
  test.info().annotations.push({ type: "invitation read", description: `${elapsedMs} ms` });
  expect(elapsedMs, "the invitation was not read within its second").toBeLessThan(READ_BUDGET_MS);
  await expect(invitedAs(page, "Viewer")).toBeVisible();
  await expect(nameField(page)).toHaveCount(0);
  await passesTheAccessibilityGate();

  await page.keyboard.press("Tab");
  await expect(joinButton(page)).toBeFocused();
  const ring = await joinButton(page).evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring, "the focused action shows no focus ring").not.toBe("none");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("banner").getByText("Ryedale Metalwork")).toBeVisible();
});
