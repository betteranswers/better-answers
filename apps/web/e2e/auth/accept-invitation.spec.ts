import { expect, test } from "../browser.ts";
import { person, provision, signIn } from "../harness.ts";
import {
  anInvitation,
  invitationHeading,
  invitedAs,
  joinButton,
  nameField,
} from "../people-pages.ts";

const READ_BUDGET_MS = 1000;

test("an invitee with a display name joins by keyboard", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Ryedale Metalwork" });
  const { address, link } = await anInvitation(request, workspace.workspaceId, "Viewer");
  await person(request, address, { displayName: "Sam Okoro" });
  await page.goto(link);
  await signIn(page, request, address);
  await expect(invitationHeading(page, "Ryedale Metalwork")).toBeVisible();

  const started = Date.now();
  await page.goto(link);
  await expect(joinButton(page)).toBeVisible();
  const elapsedMs = Date.now() - started;
  test.info().annotations.push({ type: "invitation read", description: `${elapsedMs} ms` });
  expect(elapsedMs, "the invitation took longer than one second to load").toBeLessThan(
    READ_BUDGET_MS,
  );
  await expect(invitedAs(page, "Viewer")).toBeVisible();
  await expect(nameField(page)).toHaveCount(0);
  await passesTheAccessibilityGate();

  await page.keyboard.press("Tab");
  await expect(joinButton(page)).toBeFocused();
  const ring = await joinButton(page).evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring, "the focused button shows no focus ring").not.toBe("none");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("banner").getByText("Ryedale Metalwork")).toBeVisible();
});
