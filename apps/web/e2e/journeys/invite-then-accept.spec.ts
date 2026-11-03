import assert from "node:assert/strict";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  clockTheNextKey,
  confirmedWhenAsked,
  countOf,
  emailsSentTo,
  invite,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  person,
  personMenuOpened,
  provision,
  signIn,
  signInHeading,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import {
  addressField,
  anInvitation,
  invitationHeading,
  invitationRows,
  invitationsRegion,
  inviteAction,
  inviteDialog,
  invitedAs,
  joinButton,
  MEMBERS_PAGE,
  nameField,
  openedByName,
  thePage,
} from "../people-pages.ts";

const LONG_UK_DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

const rowOf = (page: Page, address: string): Locator =>
  invitationRows(page).filter({ hasText: address });

const theOneCell = (page: Page): Locator => invitationsRegion(page).getByRole("cell");

const openInvitations = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Invitations" }).click();
  await expect(invitationsRegion(page).getByRole("heading", { name: "Invitations" })).toBeVisible();
};

const dialogOpened = async (page: Page): Promise<void> => {
  await inviteAction(page).click();
  await expect(addressField(page)).toBeFocused();
};

const activityOf = (page: Page): Locator => thePage(page).getByRole("region", { name: "Activity" });

const linesOf = (page: Page): Locator => activityOf(page).getByRole("listitem");

test("an Admin invites; invitees join; Activity shows only joining", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(request, { name: "Calder Joinery", adminEmail });

  await test.step("an Admin invites a person by address; the invitation waits", async () => {
    await page.goto(MEMBERS_PAGE);
    await signIn(page, request, adminEmail);
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    await openInvitations(page);
    await expect(invitationRows(page)).toHaveCount(0);
    await expect(theOneCell(page)).toHaveText(/\S/);
    const address = anAddress("sam");

    await dialogOpened(page);
    await addressField(page).fill(address);
    const role = inviteDialog(page).getByRole("combobox", { name: "Role" });
    const describedBy = await role.getAttribute("aria-describedby");
    assert.ok(describedBy !== null, "the Role field is described by its meaning");
    const meant = await inviteDialog(page).locator(`[id="${describedBy}"]`).innerText();
    await role.click();
    await page.getByRole("option", { name: "Editor" }).click();
    await expect(role).toHaveText("Editor");
    await expect(role).toHaveAccessibleDescription(/\S/);
    await expect(
      role,
      "the role's meaning did not follow the pick",
    ).not.toHaveAccessibleDescription(meant);
    await inviteDialog(page).getByRole("button", { name: "Send Invitation" }).click();

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(address);
    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await expect(inviteDialog(page)).toHaveCount(0);
    await expect(inviteAction(page)).toBeFocused();

    await expect(invitationRows(page)).toHaveCount(1);
    const cells = rowOf(page, address).getByRole("cell");
    await expect(cells.nth(1)).toHaveText(address);
    await expect(cells.nth(2)).toHaveText("Editor");
    await expect(cells.nth(3)).toHaveText(LONG_UK_DATE);
    await expect(cells.nth(4)).toHaveText(LONG_UK_DATE);
    await expect(cells.nth(5)).toHaveText("Test person");
    await expect(countOf(invitationsRegion(page))).toHaveText(/\b1\b/);
    await expect(
      page.getByRole("main").getByRole("status").filter({ hasText: /\d/ }),
      "a second count, the members', shows on Invitations",
    ).toHaveCount(1);
    await expect(
      invitationsRegion(page).getByRole("radio", { name: /^Waiting\b/ }),
    ).toHaveAccessibleName("Waiting 1");
    expect(await emailsSentTo(request, address), "the invitation's one email").toBe(1);
    await passesTheAccessibilityGate();
  });

  await test.step("an invited newcomer names themselves on the invitation, then joins", async () => {
    const { address, link } = await anInvitation(request, workspace.workspaceId, "Editor");

    await page.context().clearCookies();
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
    await passesTheAccessibilityGate();
  });

  await test.step("a member's Activity shows only joining, with no Load more", async () => {
    const address = anAddress("ola");
    await person(request, address, { displayName: "Ola Brennan" });
    const invited = await invite(request, {
      workspaceId: workspace.workspaceId,
      email: address,
      inviterId: workspace.admin.id,
      role: "Admin",
    });

    await page.context().clearCookies();
    await page.goto(`/invitations/${invited.id}`);
    await signIn(page, request, address);
    await joinButton(page).click();
    await confirmedWhenAsked(page, request, address);
    await landedAtHome(page, "Admin");

    await openedByName(page, "Ola Brennan");

    await expect(linesOf(page)).toHaveCount(1);
    await expect(linesOf(page)).toContainText(/Ola Brennan.*Admin/);
    await expect(activityOf(page).getByRole("button", { name: "Load More" })).toHaveCount(0);
  });
});
