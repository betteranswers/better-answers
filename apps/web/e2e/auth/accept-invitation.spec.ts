import type { APIRequestContext, Page } from "@playwright/test";

import type { Role } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import { anAddress, invite, person, provision, signIn } from "../harness.ts";

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
