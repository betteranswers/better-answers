import type { APIRequestContext, Page } from "@playwright/test";

import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  clockTheNextKey,
  invite,
  keystrokesListed,
  person,
  provision,
  signIn,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const READ_BUDGET_MS = 1000;

const LONG_UK_DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

const acceptHeading = (page: Page, workspace: string) =>
  page.getByRole("heading", { level: 1, name: `Join ${workspace}` });

const joinButton = (page: Page, workspace: string, role: string) =>
  page.getByRole("button", { name: `Join ${workspace} as ${role}` });

/** A workspace, a named inviter and a waiting invitation to a fresh address, not yet signed in. */
const anInvitation = async (
  request: APIRequestContext,
  workspaceName: string,
  role: "Admin" | "Editor" | "Viewer" = "Editor",
) => {
  const workspace = await provision(request, { name: workspaceName });
  const inviter = await person(request, anAddress("morgan"), { displayName: "Morgan Reid" });
  const address = anAddress("priya");
  const invited = await invite(request, {
    workspaceId: workspace.workspaceId,
    email: address,
    inviterId: inviter.id,
    role,
  });
  return { workspace, address, link: `/invitations/${invited.id}` };
};

test("an invited newcomer signs in, gives a name, and joins", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Calder Joinery", "Editor");

  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await signIn(page, request, address);

  await expect(page.getByRole("heading", { level: 1, name: "Your display name" })).toBeVisible();
  await page.getByLabel("Display name").fill("Priya Shah");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(acceptHeading(page, "Calder Joinery")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${link}$`));
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Join Calder Joinery" [level=1]
      - paragraph: You are invited to join Calder Joinery as an Editor.
      - term: Invited by
      - definition: Morgan Reid
      - term: Lasts until
      - definition: ${LONG_UK_DATE.toString()}
      - term: Signed in as
      - definition: ${address}
      - button "Join Calder Joinery as an Editor"
      - paragraph: You become a member at once, and the workspace's audit log records that you joined.
      - button "Sign out"
      - button ${JSON.stringify(KEYSTROKE_WORDS.button)}
  `);
  await passesTheAccessibilityGate();

  const keystrokes = await keystrokesListed(page, "this screen");
  await expect(keystrokes).toContainText("Join the workspace");
  await page.keyboard.press("Escape");
  await expect(keystrokes).toBeHidden();

  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Joining" });
  await page.keyboard.press("j");
  await theActLandedWithinItsBudget(page, "accept");

  const bar = page.getByRole("banner");
  await expect(bar.getByText("Calder Joinery")).toBeVisible();
  await expect(bar.getByRole("button", { name: /Priya Shah/ })).toContainText("Editor");
});

test("a named invitee reads it within a second, joins keyboard-only", async ({ page, request }) => {
  const { address, link } = await anInvitation(request, "Ryedale Metalwork", "Viewer");
  await person(request, address, { displayName: "Sam Okoro" });
  await page.goto(link);
  await signIn(page, request, address);
  await expect(acceptHeading(page, "Ryedale Metalwork")).toBeVisible();

  const started = Date.now();
  await page.goto(link);
  await expect(joinButton(page, "Ryedale Metalwork", "a Viewer")).toBeVisible();
  const elapsedMs = Date.now() - started;
  test.info().annotations.push({ type: "invitation read", description: `${elapsedMs} ms` });
  expect(elapsedMs, "the invitation was not read within its second").toBeLessThan(READ_BUDGET_MS);

  await page.keyboard.press("Tab");
  await expect(joinButton(page, "Ryedale Metalwork", "a Viewer")).toBeFocused();
  const ring = await joinButton(page, "Ryedale Metalwork", "a Viewer").evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  expect(ring, "the focused act shows no focus ring").not.toBe("none");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("banner").getByText("Ryedale Metalwork")).toBeVisible();
});

test("refuses a person at another address, offering the invited one", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Brightwater Estimating");
  await person(request, address, { displayName: "Priya Shah" });
  const other = anAddress("theo");
  await person(request, other, { displayName: "Theo Other" });

  await page.goto(link);
  await signIn(page, request, other);

  const refusal = page.getByRole("alert");
  await expect(refusal).toContainText("invitation-for-another-address");
  await expect(refusal).toContainText(
    "This invitation was sent to another email address than the one you are signed in with. Sign in with the address it was sent to.",
  );
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Your invitation" [level=1]
      - alert:
        - text: "Refused:"
        - code: invitation-for-another-address
        - text: . This invitation was sent to another email address than the one you are signed in with. Sign in with the address it was sent to.
      - button "Sign in with another address"
      - button "Sign out"
      - button ${JSON.stringify(KEYSTROKE_WORDS.button)}
  `);
  await expect(page.getByRole("main")).not.toContainText("Brightwater Estimating");
  await passesTheAccessibilityGate();

  const keystrokes = await keystrokesListed(page, "this screen");
  await expect(keystrokes).toContainText("Sign in with another address");
  await page.keyboard.press("Escape");
  await expect(keystrokes).toBeHidden();
  await page.keyboard.press("s");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await signIn(page, request, address);

  await expect(acceptHeading(page, "Brightwater Estimating")).toBeVisible();
});

test("tells a named person a stray link names no invitation", async ({ page, request }) => {
  const address = anAddress("stray");
  await person(request, address, { displayName: "Una Price" });

  await page.goto("/invitations/01J0000000000000000000000Z");
  await signIn(page, request, address);

  const refusal = page.getByRole("alert");
  await expect(refusal).toContainText("no-such-invitation");
  await expect(refusal).toContainText(
    "No invitation stands at this link: it was cancelled, replaced by a newer one, or never sent. Ask the Admin who invited you to send a new one.",
  );
  await expect(page.getByRole("button", { name: /^Join/ })).toHaveCount(0);
});
