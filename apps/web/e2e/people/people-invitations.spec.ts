import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  countOf,
  emailsSentTo,
  invite,
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  person,
  provision,
  editorPickedByKeyboard,
  signIn,
  tabOpenedByKeyboard,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
} from "../harness.ts";

const people = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS_PAGE = pageNamed(people, "Members").path;

const LONG_UK_DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

type Status = "Waiting" | "Accepted" | "Expired" | "Cancelled";

const invitationsRegion = (page: Page) => page.getByRole("region", { name: "Invitations" });

const invitationRows = (page: Page): Locator =>
  invitationsRegion(page).getByRole("row").filter({ hasText: "@" });

const rowOf = (page: Page, address: string): Locator =>
  invitationRows(page).filter({ hasText: address });

const statusChoice = (page: Page, status: Status): Locator =>
  invitationsRegion(page).getByRole("radio", { name: new RegExp(`^${status}\\b`) });

const countedUnder = (page: Page, status: Status, count: number) =>
  expect(statusChoice(page, status)).toHaveAccessibleName(`${status} ${count}`);

const tickOf = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("checkbox", { name: `Select ${address}`, exact: true });

const menuOf = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("button", { name: `Actions for ${address}` });

const saidInTheTab = (page: Page, address: string | RegExp): Locator =>
  invitationsRegion(page).getByRole("status").filter({ hasText: address });

const theOneCell = (page: Page): Locator => invitationsRegion(page).getByRole("cell");

const outcomeIn = (page: Page): Locator => invitationsRegion(page).getByRole("status").nth(1);

const THE_COUNT = "//section[.//h2[.='Invitations']]//output";

const INVITE = "Invite a Person";

const inviteDialog = (page: Page) => page.getByRole("dialog", { name: INVITE });

const inviteAction = (page: Page) => page.getByRole("button", { name: INVITE, exact: true });

const addressField = (page: Page) => inviteDialog(page).getByLabel("Email Addresses");

const heldAddresses = (page: Page) =>
  inviteDialog(page).getByRole("list", { name: "Addresses to Invite" }).getByRole("listitem");

type AtInvitations = {
  readonly workspaceId: string;
  readonly adminId: string;
};

const anAdminAtInvitations = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
  seed: (at: AtInvitations) => Promise<void> = async () => {},
): Promise<AtInvitations> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail });
  const made = await person(api, anAddress("editor"), { displayName: "Priya Shah" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: made.id, role: "Editor" });
  const at = { workspaceId: workspace.workspaceId, adminId: workspace.admin.id };
  await seed(at);

  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, adminEmail);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  return at;
};

const openInvitations = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Invitations" }).click();
  await expect(invitationsRegion(page).getByRole("heading", { name: "Invitations" })).toBeVisible();
};

const invitedEach = async (
  api: APIRequestContext,
  at: AtInvitations,
  addresses: readonly string[],
): Promise<void> => {
  for (const email of addresses) {
    await invite(api, {
      workspaceId: at.workspaceId,
      email,
      inviterId: at.adminId,
      role: "Viewer",
    });
  }
};

const dialogOpened = async (page: Page): Promise<void> => {
  await inviteAction(page).click();
  await expect(addressField(page)).toBeFocused();
};

test.describe("the People page's Invitations tab", () => {
  test("an Admin invites a person by address; the invitation waits", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Calder Joinery");
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
    await countedUnder(page, "Waiting", 1);
    expect(await emailsSentTo(request, address), "the invitation's one email").toBe(1);
  });

  test("an Admin resends and cancels an invitation by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const kept = anAddress("kept");
    const dropped = anAddress("dropped");
    await anAdminAtInvitations(page, request, "Calder Castings", (at) =>
      invitedEach(request, at, [kept, dropped]),
    );
    await tabOpenedByKeyboard(page, MEMBERS_PAGE, "Invitations");
    await expect(invitationRows(page)).toHaveCount(2);

    await tabUntilFocused(page, menuOf(page, dropped));
    await page.keyboard.press(PEOPLE_KEYSTROKES.resend.key);
    await expect(saidInTheTab(page, new RegExp(`${dropped}.*\\d{4}`))).toBeVisible();
    const saidOfTheResend = await outcomeIn(page).innerText();

    await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
    await expect(tickOf(page, dropped)).toBeChecked();
    await expect(outcomeIn(page), "a tick wiped the resend's outcome").toHaveText(saidOfTheResend);
    await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
    await expect(tickOf(page, dropped)).not.toBeChecked();

    await expect(countOf(invitationsRegion(page))).toHaveText(/\b2\b/);
    await clockTheNextKey(page, { at: THE_COUNT, reads: "1" });
    await page.keyboard.press(PEOPLE_KEYSTROKES.cancel.key);
    await expect(rowOf(page, dropped)).toHaveCount(0);
    await theActionLandedWithinItsBudget(page, "cancel");
    await expect(
      invitationsRegion(page).getByRole("heading", { name: "Invitations" }),
    ).toBeFocused();
    await expect(outcomeIn(page)).toContainText(dropped);
    await expect(outcomeIn(page), "the cancel said nothing of its own").not.toHaveText(
      saidOfTheResend,
    );

    const keystrokes = await keystrokesListed(page, "Members");
    for (const listed of [
      PEOPLE_KEYSTROKES.invite,
      PEOPLE_KEYSTROKES.searchInvitations,
      PEOPLE_KEYSTROKES.resend,
      PEOPLE_KEYSTROKES.cancel,
      PEOPLE_KEYSTROKES.tickInvitation,
      PEOPLE_KEYSTROKES.resendSelected,
      PEOPLE_KEYSTROKES.cancelSelected,
      PEOPLE_KEYSTROKES.nextInvitations,
    ]) {
      await expect(
        keyListed(keystrokes, listed.key),
        `the list holds no ${listed.key}`,
      ).toBeVisible();
    }
    await expect(
      keyListed(keystrokes, PEOPLE_KEYSTROKES.open.key),
      "the Members tab's keystrokes on Invitations",
    ).toHaveCount(0);
    await keystrokesDismissed(page, keystrokes);

    const invited = anAddress("invited");
    await page.keyboard.press(PEOPLE_KEYSTROKES.invite.key);
    await expect(addressField(page)).toBeFocused();
    await page.keyboard.type(invited);
    await page.keyboard.press("Tab");
    await editorPickedByKeyboard(page, inviteDialog(page).getByRole("combobox", { name: "Role" }));
    await page.keyboard.press("Shift+Tab");
    await expect(addressField(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(heldAddresses(page)).toHaveCount(1);
    await expect(addressField(page)).toHaveValue("");
    await page.keyboard.press("Enter");
    await expect(inviteDialog(page).getByRole("status").first()).toContainText(invited);
    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
    await passesTheAccessibilityGate();
    await page.keyboard.press("Enter");
    await expect(inviteDialog(page)).toHaveCount(0);
    await expect(inviteAction(page)).toBeFocused();
    await expect(invitationRows(page)).toHaveCount(2);

    await expect(invitationsRegion(page)).toMatchAriaSnapshot(`
      - region "Invitations":
        - heading "Invitations" [level=2]
        - status: /\\b2\\b/
        - status: /dropped-\\d+/
        - searchbox "Search by address"
        - radiogroup "Status":
          - radio "Waiting 2" [checked]
          - radio "Accepted 0"
          - radio "Expired 0"
          - radio "Cancelled 1"
        - table:
          - caption
          - rowgroup:
            - row:
              - columnheader "Select every invitation on this page"
              - columnheader "Address"
              - columnheader "Role"
              - columnheader "Sent"
              - columnheader "Expires"
              - columnheader "Invited By"
              - columnheader "Actions"
          - rowgroup:
            - row /invited-/:
              - cell:
                - checkbox /Select invited-/
              - cell /invited-/
              - cell "Editor"
              - cell /\\d{4}/
              - cell /\\d{4}/
              - cell "Test person"
              - cell:
                - button /Actions for invited-/
            - row /kept-/
    `);
  });
});
