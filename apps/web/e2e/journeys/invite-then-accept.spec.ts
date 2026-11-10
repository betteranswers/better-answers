import assert from "node:assert/strict";

import type { Locator, Page } from "@playwright/test";

import { INVITATION_WORDS } from "@/features/auth/workspace/invitation-words.ts";
import { INVITE_WORDS } from "@/features/people/invitation-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { DISPLAY_NAME_WORDS } from "@/shared/member/display-name-words.ts";
import { LIST_WORDS } from "@/shared/words.ts";

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
  actionWithinBudget,
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

const invitationRow = (page: Page, address: string): Locator =>
  invitationRows(page).filter({ hasText: address });

const emptyStateCell = (page: Page): Locator => invitationsRegion(page).getByRole("cell");

const openInvitations = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Invitations" }).click();
  await expect(invitationsRegion(page).getByRole("heading", { name: "Invitations" })).toBeVisible();
};

const openInviteDialog = async (page: Page): Promise<void> => {
  await inviteAction(page).click();
  await expect(addressField(page)).toBeFocused();
};

const activityOf = (page: Page): Locator => thePage(page).getByRole("region", { name: "Activity" });

const activityItems = (page: Page): Locator => activityOf(page).getByRole("listitem");

test("invited people join, and their Activity shows only the join", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(request, { name: "Calder Joinery", adminEmail });

  await test.step("an Admin invites a person and the invitation is Waiting", async () => {
    await page.goto(MEMBERS_PAGE);
    await signIn(page, request, adminEmail);
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
    await openInvitations(page);
    await expect(invitationRows(page)).toHaveCount(0);
    await expect(emptyStateCell(page)).toHaveText(/\S/);
    const address = anAddress("sam");

    await openInviteDialog(page);
    await addressField(page).fill(address);
    const role = inviteDialog(page).getByRole("combobox", { name: "Role" });
    const describedBy = await role.getAttribute("aria-describedby");
    assert.ok(describedBy !== null, "the Role field has no aria-describedby");
    const firstDescription = await inviteDialog(page).locator(`[id="${describedBy}"]`).innerText();
    await role.click();
    await page.getByRole("option", { name: "Editor" }).click();
    await expect(role).toHaveText("Editor");
    await expect(role).toHaveAccessibleDescription(/\S/);
    await expect(
      role,
      "the Role description did not change when the Admin picked Editor",
    ).not.toHaveAccessibleDescription(firstDescription);
    await inviteDialog(page)
      .getByRole("button", { name: INVITE_WORDS.send(1) })
      .click();

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(address);
    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await expect(inviteDialog(page)).toHaveCount(0);
    await expect(inviteAction(page)).toBeFocused();

    await expect(invitationRows(page)).toHaveCount(1);
    const cells = invitationRow(page, address).getByRole("cell");
    await expect(cells.nth(1)).toHaveText(address);
    await expect(cells.nth(2)).toHaveText("Editor");
    await expect(cells.nth(3)).toHaveText(LONG_UK_DATE);
    await expect(cells.nth(4)).toHaveText(LONG_UK_DATE);
    await expect(cells.nth(5)).toHaveText("Test person");
    await expect(countOf(invitationsRegion(page))).toHaveText(/\b1\b/);
    await expect(
      page.getByRole("main").getByRole("status").filter({ hasText: /\d/ }),
      "the page does not show exactly one count",
    ).toHaveCount(1);
    await expect(
      invitationsRegion(page).getByRole("radio", { name: /^Waiting\b/ }),
    ).toHaveAccessibleName("Waiting 1");
    expect(
      await emailsSentTo(request, address),
      "the invitation did not send exactly one email",
    ).toBe(1);
    await passesTheAccessibilityGate();
  });

  await test.step("a new person enters a display name and joins", async () => {
    const { address, link } = await anInvitation(request, workspace.workspaceId, "Editor");

    await page.context().clearCookies();
    await page.goto(link);
    await expect(signInHeading(page, "joining")).toBeVisible();
    await signIn(page, request, address);

    await expect(invitationHeading(page, "Calder Joinery")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${link}$`));
    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main:
        - heading ${JSON.stringify(INVITATION_WORDS.heading("Calder Joinery"))} [level=1]
        - paragraph
        - paragraph
        - textbox ${JSON.stringify(DISPLAY_NAME_WORDS.label)}
        - button ${JSON.stringify(INVITATION_WORDS.join)}
        - button "Sign Out"
        - button ${JSON.stringify(KEYSTROKE_WORDS.button)}
    `);
    await expect(invitedAs(page, "Editor")).toBeVisible();
    await passesTheAccessibilityGate();

    const keystrokes = await keystrokesListed(page, KEYSTROKE_WORDS.thisPage);
    await expect(keystrokes.getByRole("term").filter({ hasText: /^j$/ })).toBeVisible();
    await keystrokesDismissed(page, keystrokes);

    await nameField(page).fill("Priya Shah");
    await page.keyboard.press("Tab");
    await expect(joinButton(page)).toBeFocused();
    await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Joining" });
    await page.keyboard.press("j");
    await actionWithinBudget(page, "name and accept");

    const header = page.getByRole("banner");
    await expect(header.getByText("Calder Joinery")).toBeVisible();
    await expect(await personMenuOpened(page, "Priya Shah")).toContainText("Editor");
    await passesTheAccessibilityGate();
  });

  await test.step("a new member's Activity shows only their join", async () => {
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

    await expect(activityItems(page)).toHaveCount(1);
    await expect(activityItems(page)).toContainText(/Ola Brennan.*Admin/);
    await expect(activityOf(page).getByRole("button", { name: LIST_WORDS.loadMore })).toHaveCount(
      0,
    );
  });
});
