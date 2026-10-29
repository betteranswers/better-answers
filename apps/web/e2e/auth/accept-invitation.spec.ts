import type { APIRequestContext, Page } from "@playwright/test";

import type { Role } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  invite,
  keepsItsWordOffThePage,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  person,
  personMenuOpened,
  provision,
  saysARefusal,
  signIn,
  signInHeading,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const READ_BUDGET_MS = 1000;

const INVITER = "Morgan Reid";

const THE_INVITATION = "person.invitation";

const THE_JOIN = "person.acceptInvitation";

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

test("keeps a given name when the join is then refused", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspace, address, link } = await anInvitation(request, "Ashby Survey", "Editor");
  const invitee = await person(request, address, { displayName: "" });
  await page.goto(link);
  await signIn(page, request, address);
  await expect(nameField(page)).toBeVisible();
  await addMember(request, {
    workspaceId: workspace.workspaceId,
    userId: invitee.id,
    role: "Viewer",
  });

  await nameField(page).fill("Ines Moreau");
  const refused = refusalAnswering(page, THE_JOIN);
  await joinButton(page).click();

  expect(await refused).toMatchObject({ word: "already-a-member" });
  await saysARefusal(page.getByRole("alert"));
  await keepsItsWordOffThePage(page, "already-a-member");
  await passesTheAccessibilityGate();

  await page.getByRole("button", { name: "Go to Your Workspaces" }).click();
  await landedAtHome(page, "Viewer");
  await expect(page.getByRole("banner").getByRole("button", { name: /Ines Moreau/ })).toBeVisible();
});

const signedInAtAnotherAddress = async (
  page: Page,
  request: APIRequestContext,
  workspaceName: string,
) => {
  const { address, link } = await anInvitation(request, workspaceName, "Editor");
  await person(request, address, { displayName: "Priya Shah" });
  const other = anAddress("theo");
  await person(request, other, { displayName: "Theo Other" });

  await page.goto(link);
  const refused = refusalAnswering(page, THE_INVITATION);
  await signIn(page, request, other);

  expect(await refused).toMatchObject({ word: "invitation-for-another-address" });
  return { address, link };
};

test("refuses a person at another address, offering the invited one", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address } = await signedInAtAnotherAddress(page, request, "Brightwater Estimating");
  await saysARefusal(page.getByRole("alert"));
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Your Invitation" [level=1]
      - alert
      - button "Sign In with Another Address"
      - button "Sign Out"
      - button "Keyboard Shortcuts"
  `);
  await expect(page.getByRole("main")).not.toContainText("Brightwater Estimating");
  await passesTheAccessibilityGate();

  const keystrokes = await keystrokesListed(page, "This Page");
  await expect(keystrokes.getByRole("term").filter({ hasText: /^s$/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(keystrokes).toBeHidden();
  await page.keyboard.press("s");
  await expect(signInHeading(page, "joining")).toBeVisible();
  await signIn(page, request, address);

  await expect(invitationHeading(page, "Brightwater Estimating")).toBeVisible();
});

test("tells a named person a stray link names no invitation", async ({ page, request }) => {
  const address = anAddress("stray");
  await person(request, address, { displayName: "Una Price" });

  await page.goto("/invitations/01J0000000000000000000000Z");
  const refused = refusalAnswering(page, THE_INVITATION);
  await signIn(page, request, address);

  expect(await refused).toMatchObject({ word: "no-such-invitation" });
  await saysARefusal(page.getByRole("alert"));
  await keepsItsWordOffThePage(page, "no-such-invitation");
  await expect(page.getByRole("button", { name: /^Join/ })).toHaveCount(0);
});
